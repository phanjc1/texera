/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package edu.uci.ics.texera.web.resource

import com.typesafe.scalalogging.LazyLogging
import edu.uci.ics.amber.util.JSONUtils
import edu.uci.ics.texera.web.ServletAwareConfigurator
import edu.uci.ics.texera.web.model.collab.event._
import edu.uci.ics.texera.web.model.collab.request._
import edu.uci.ics.texera.web.model.collab.response.HeartBeatResponse
import edu.uci.ics.texera.dao.jooq.generated.tables.pojos.User
import edu.uci.ics.texera.web.resource.CollaborationResource._
import edu.uci.ics.texera.web.resource.dashboard.user.workflow.WorkflowAccessResource

import javax.websocket.server.ServerEndpoint
import javax.websocket.{OnClose, OnMessage, OnOpen, Session}
import scala.collection.mutable
import scala.jdk.CollectionConverters.MapHasAsScala

object CollaborationResource {
  final val sessionIdSessionMap = new mutable.HashMap[String, Session]()
  final val sessionIdWIdMap = new mutable.HashMap[String, Int]()
  final val sessionIdUIdMap = new mutable.HashMap[String, Int]()
  final val wIdSessionIdsMap = new mutable.HashMap[Int, mutable.Set[String]]()
  final val wIdLockHolderSessionIdMap = new mutable.HashMap[Int, String]()
  final val DUMMY_WID = -1

  private def checkIsReadOnly(wId: Int, uId: Int): Boolean = {
    !WorkflowAccessResource.hasWriteAccess(Integer.valueOf(wId), Integer.valueOf(uId))
  }
}

@ServerEndpoint(
  value = "/wsapi/collab",
  configurator = classOf[ServletAwareConfigurator]
)
class CollaborationResource extends LazyLogging {

  final val objectMapper = JSONUtils.objectMapper

  @OnMessage
  def myOnMsg(senderSession: Session, message: String): Unit = {
    val request = objectMapper.readValue(message, classOf[CollabWebSocketRequest])
    val uidOpt = senderSession.getUserProperties.asScala
      .get(classOf[User].getName)
      .map(_.asInstanceOf[User].getUid)
    val senderSessId = senderSession.getId
    request match {
      case wIdRequest: WIdRequest =>
        val wId: Int = uidOpt match {
          case Some(uId) =>
            sessionIdUIdMap(senderSessId) = uId.intValue()
            val wId = wIdRequest.wId
            logger.info("New session from " + uId + " on workflow with workflowId: " + wId)
            wId
          case None =>
            // use a fixed wid for reconnection
            DUMMY_WID
        }
        sessionIdWIdMap(senderSessId) = wId
        val sessionIdSet: mutable.Set[String] =
          wIdSessionIdsMap.get(wId) match {
            case Some(set) =>
              set.union(Set(senderSessId))
            case None =>
              mutable.Set(senderSessId)
          }
        wIdSessionIdsMap(wId) = sessionIdSet

      case commandRequest: CommandRequest =>
        logger.debug("Received command message: " + commandRequest.commandMessage)
        for (sessionId <- sessionIdSessionMap.keySet) {
          // only send to other sessions, not the session that sent the message
          val session = sessionIdSessionMap(sessionId)
          val sessionWId = sessionIdWIdMap.get(sessionId)
          val senderWId = sessionIdWIdMap.get(senderSessId)
          if (
            session != senderSession && sessionWId.isDefined && senderWId.isDefined && senderWId == sessionWId
          ) {
            send(session, CommandEvent(commandRequest.commandMessage))
            logger.debug("Message propagated to workflow " + sessionWId.toString)
          }
        }
      case heartbeat: HeartBeatRequest =>
        send(senderSession, HeartBeatResponse())

      case tryLock: TryLockRequest =>
        val wId = sessionIdWIdMap(senderSessId)
        if (wId == DUMMY_WID) {
          send(senderSession, WorkflowAccessEvent(workflowReadonly = false))
          send(senderSession, LockGrantedEvent())
        } else {
          val uId = sessionIdUIdMap(senderSessId)
          if (checkIsReadOnly(wId, uId)) {
            send(senderSession, LockRejectedEvent())
            send(senderSession, WorkflowAccessEvent(workflowReadonly = true))
            if (!wIdLockHolderSessionIdMap.keySet.contains(wId)) {
              wIdLockHolderSessionIdMap(wId) = null
            }
          } else {
            send(senderSession, WorkflowAccessEvent(workflowReadonly = false))
            if (
              !wIdLockHolderSessionIdMap.keySet.contains(wId) || wIdLockHolderSessionIdMap(
                wId
              ) == null || wIdLockHolderSessionIdMap(wId) == senderSessId
            ) {
              grantLock(senderSession, senderSessId, wId)
            } else {
              send(senderSession, LockRejectedEvent())
            }
          }
        }

      case acquireLock: AcquireLockRequest =>
        try {
          val senderSessId = senderSession.getId
          val senderWid = sessionIdWIdMap(senderSessId)
          if (wIdLockHolderSessionIdMap(senderWid) != senderSessId) {
            val holderSessId = wIdLockHolderSessionIdMap(senderWid)
            val holderSession = sessionIdSessionMap(holderSessId)
            send(holderSession, ReleaseLockEvent())
            send(senderSession, LockGrantedEvent())
            wIdLockHolderSessionIdMap(senderWid) = senderSessId
            logger.info("Session " + senderSessId + " has lock on " + senderWid)
          } else {
            send(senderSession, LockGrantedEvent())
          }
        } catch {
          case exception: Exception =>
            logger.error("Session " + senderSessId + " acquire lock failed.")
            throw exception
        }

      case restoreVersion: RestoreVersionRequest =>
        for (sessionId <- sessionIdSessionMap.keySet) {
          // only send to other sessions, not the session that sent the message
          val session = sessionIdSessionMap(sessionId)
          val sessionStateId = sessionIdWIdMap.get(sessionId)
          val senderStateId = sessionIdWIdMap.get(senderSession.getId)
          if (
            session != senderSession && sessionStateId.isDefined && senderStateId.isDefined && senderStateId == sessionStateId
          ) {
            send(session, RestoreVersionEvent())
            logger.info("Reload propagated to workflow " + sessionStateId.toString)
          }
        }
    }
  }

  @OnOpen
  def myOnOpen(session: Session): Unit = {
    sessionIdSessionMap += (session.getId -> session)
  }

  @OnClose
  def myOnClose(senderSession: Session): Unit = {
    val senderSessId = senderSession.getId
    sessionIdSessionMap -= senderSessId
    if (sessionIdWIdMap.contains(senderSessId)) {
      val wId = sessionIdWIdMap(senderSessId)
      if (wIdSessionIdsMap.contains(wId)) {
        wIdSessionIdsMap(wId) -= senderSessId
        if (
          wIdLockHolderSessionIdMap.contains(wId) && wIdLockHolderSessionIdMap(wId) == senderSessId
        ) {
          wIdLockHolderSessionIdMap(wId) = null
          val set = wIdSessionIdsMap(wId)
          if (set.nonEmpty) {
            var granted = false
            for (sessId <- set) {
              if (!checkIsReadOnly(wId, sessionIdUIdMap(sessId)) && !granted) {
                grantLock(sessionIdSessionMap(sessId), sessId, wId)
                granted = true
              }
            }
          }
        }
      }
      sessionIdWIdMap -= senderSessId
    }
    logger.info("Session " + senderSessId + " disconnected")
  }

  private def grantLock(session: Session, sessionId: String, wId: Int): Unit = {
    wIdLockHolderSessionIdMap(wId) = sessionId
    logger.info("Session " + sessionId + " has lock on " + wId + " now")
    send(session, LockGrantedEvent())
  }

  private def send(session: Session, msg: CollabWebSocketEvent): Unit = {
    session.getAsyncRemote.sendText(objectMapper.writeValueAsString(msg))
  }
}
