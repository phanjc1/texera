/**
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

import { ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import { ComputingUnitStatusService } from "../../../../../workspace/service/computing-unit-status/computing-unit-status.service";
import { extractErrorMessage } from "../../../../../common/util/error";
import { NotificationService } from "../../../../../common/service/notification/notification.service";
import { NzModalService } from "ng-zorro-antd/modal";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import {
  DashboardWorkflowComputingUnit,
  WorkflowComputingUnit,
} from "../../../../../workspace/types/workflow-computing-unit";
import { WorkflowComputingUnitManagingService } from "../../../../../workspace/service/workflow-computing-unit/workflow-computing-unit-managing.service";
import {
  buildComputingUnitMetadataTable,
  parseResourceUnit,
  parseResourceNumber,
  cpuResourceConversion,
  memoryResourceConversion,
  cpuPercentage,
  memoryPercentage
} from "../../../../../common/util/computing-unit.util";

@UntilDestroy()
@Component({
  selector: "texera-user-computing-unit-list-item",
  templateUrl: "./user-computing-unit-list-item.component.html",
  styleUrls: ["./user-computing-unit-list-item.component.scss"],
})
export class UserComputingUnitListItemComponent implements OnInit {
  private _entry?: DashboardWorkflowComputingUnit;
  editingNameOfUnit: number | null = null;
  editingUnitName: string = "";
  gpuOptions: string[] = [];
  @Input() editable = false;
  @Output() deleted = new EventEmitter<void>();

  @Input()
  get entry(): DashboardWorkflowComputingUnit {
    if (!this._entry) {
      throw new Error("entry property must be provided to UserComputingUnitListItemComponent.");
    }
    return this._entry;
  }

  set entry(value: DashboardWorkflowComputingUnit) {
    this._entry = value;
  }

  get unit(): WorkflowComputingUnit {
    if (!this.entry.computingUnit) {
      throw new Error(
        "Incorrect type of DashboardEntry provided to UserComputingUnitListItemComponent. Entry must be computing unit."
      );
    }
    return this.entry.computingUnit;
  }

  constructor(
    private cdr: ChangeDetectorRef,
    private modalService: NzModalService,
    private notificationService: NotificationService,
    private computingUnitService: WorkflowComputingUnitManagingService,
    private computingUnitStatusService: ComputingUnitStatusService
  ) {}

  ngOnInit(): void {
    this.computingUnitService
      .getComputingUnitLimitOptions()
      .pipe(untilDestroyed(this))
      .subscribe({
        next: ({ gpuLimitOptions }) => {
          this.gpuOptions = gpuLimitOptions ?? [];
        },
        error: (err: unknown) =>
          this.notificationService.error(`Failed to fetch resource options: ${extractErrorMessage(err)}`),
      });
  }

  startEditingUnitName(entry: DashboardWorkflowComputingUnit): void {
    if (!entry.isOwner) {
      this.notificationService.error("Only owners can rename computing units");
      return;
    }

    this.editingNameOfUnit = entry.computingUnit.cuid;
    this.editingUnitName = entry.computingUnit.name;

    // Force change detection and focus the input
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.querySelector(".unit-name-edit-input") as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  confirmUpdateUnitName(cuid: number, newName: string): void {
    const trimmedName = newName.trim();

    if (!trimmedName) {
      this.notificationService.error("Computing unit name cannot be empty");
      this.editingNameOfUnit = null;
      return;
    }

    if (trimmedName.length > 128) {
      this.notificationService.error("Computing unit name cannot exceed 128 characters");
      this.editingNameOfUnit = null;
      return;
    }

    this.computingUnitService
      .renameComputingUnit(cuid, trimmedName)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          if (this.entry.computingUnit.cuid === cuid) {
            this.entry.computingUnit.name = trimmedName;
          }
          // Refresh the computing units list
          this.computingUnitStatusService.refreshComputingUnitList();
        },
        error: (err: unknown) => {
          this.notificationService.error(`Failed to rename computing unit: ${extractErrorMessage(err)}`);
        },
      })
      .add(() => {
        this.editingNameOfUnit = null;
        this.editingUnitName = "";
      });
  }

  cancelEditingUnitName(): void {
    this.editingNameOfUnit = null;
    this.editingUnitName = "";
  }

  openComputingUnitMetadataModal(entry: DashboardWorkflowComputingUnit) {
    this.modalService.create({
      nzTitle: "Computing Unit Information",
      nzContent: buildComputingUnitMetadataTable(entry),
      nzFooter: null,
      nzMaskClosable: true,
      nzWidth: "600px",
    });
  }

  getBadgeColor(status: string): string {
    switch (status) {
      case "Running":
        return "green";
      case "Pending":
        return "gold";
      default:
        return "red";
    }
  }

  getUnitStatusTooltip(entry: DashboardWorkflowComputingUnit): string {
    switch (entry.status) {
      case "Running":
        return "Ready to use";
      case "Pending":
        return "Computing unit is starting up";
      default:
        return entry.status;
    }
  }

  getCpuPercentage(): number {
    return cpuPercentage(
      this.getCurrentComputingUnitCpuUsage(),
      this.getCurrentComputingUnitCpuLimit()
    );
  }

  getMemoryPercentage(): number {
    return memoryPercentage(
      this.getCurrentComputingUnitMemoryUsage(),
      this.getCurrentComputingUnitMemoryLimit()
    );
  }

  getCpuStatus(): "success" | "exception" | "active" | "normal" {
    const percentage = this.getCpuPercentage();
    if (percentage > 90) return "exception";
    if (percentage > 50) return "normal";
    return "success";
  }

  getMemoryStatus(): "success" | "exception" | "active" | "normal" {
    const percentage = this.getMemoryPercentage();
    if (percentage > 90) return "exception";
    if (percentage > 50) return "normal";
    return "success";
  }

  getCurrentComputingUnitCpuUsage(): string {
    return this.entry?.metrics?.cpuUsage ?? "N/A";
  }

  getCurrentComputingUnitMemoryUsage(): string {
    return this.entry?.metrics?.memoryUsage ?? "N/A";
  }

  getCurrentComputingUnitCpuLimit(): string {
    return this.unit?.resource?.cpuLimit ?? "N/A";
  }

  getCurrentComputingUnitMemoryLimit(): string {
    return this.unit?.resource?.memoryLimit ?? "N/A";
  }

  getCurrentComputingUnitGpuLimit(): string {
    return this.unit?.resource?.gpuLimit ?? "N/A";
  }

  getCurrentComputingUnitJvmMemorySize(): string {
    return this.unit?.resource?.jvmMemorySize ?? "N/A";
  }

  getCurrentSharedMemorySize(): string {
    return this.unit?.resource?.shmSize ?? "N/A";
  }

  getCpuLimit(): number {
    return parseResourceNumber(this.getCurrentComputingUnitCpuLimit());
  }

  getGpuLimit(): string {
    return this.getCurrentComputingUnitGpuLimit();
  }

  getJvmMemorySize(): string {
    return this.getCurrentComputingUnitJvmMemorySize();
  }

  getSharedMemorySize(): string {
    return this.getCurrentSharedMemorySize();
  }

  getCpuLimitUnit(): string {
    const unit = parseResourceUnit(this.getCurrentComputingUnitCpuLimit());
    if (unit === "") {
      return "CPU";
    }
    return unit;
  }

  getMemoryLimit(): number {
    return parseResourceNumber(this.getCurrentComputingUnitMemoryLimit());
  }

  getMemoryLimitUnit(): string {
    return parseResourceUnit(this.getCurrentComputingUnitMemoryLimit());
  }

  getCpuValue(): number {
    const usage = this.getCurrentComputingUnitCpuUsage();
    const limit = this.getCurrentComputingUnitCpuLimit();
    if (usage === "N/A" || limit === "N/A") return 0;
    const displayUnit = this.getCpuLimitUnit() === "CPU" ? "" : this.getCpuLimitUnit();
    const usageValue = cpuResourceConversion(usage, displayUnit);
    return parseFloat(usageValue);
  }

  getMemoryValue(): number {
    const usage = this.getCurrentComputingUnitMemoryUsage();
    const limit = this.getCurrentComputingUnitMemoryLimit();
    if (usage === "N/A" || limit === "N/A") return 0;
    const displayUnit = this.getMemoryLimitUnit();
    const usageValue = memoryResourceConversion(usage, displayUnit);
    return parseFloat(usageValue);
  }

  showGpuSelection(): boolean {
    return this.gpuOptions.length > 1 || (this.gpuOptions.length === 1 && this.gpuOptions[0] !== "0");
  }

  formatTime(timestamp: number | undefined): string {
    if (timestamp === undefined) {
      return "Unknown"; // Return "Unknown" if the timestamp is undefined
    }

    const currentTime = new Date().getTime();
    const timeDifference = currentTime - timestamp;

    const minutesAgo = Math.floor(timeDifference / (1000 * 60));
    const hoursAgo = Math.floor(timeDifference / (1000 * 60 * 60));
    const daysAgo = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    const weeksAgo = Math.floor(daysAgo / 7);

    if (minutesAgo < 60) {
      return `${minutesAgo} minutes ago`;
    } else if (hoursAgo < 24) {
      return `${hoursAgo} hours ago`;
    } else if (daysAgo < 7) {
      return `${daysAgo} days ago`;
    } else if (weeksAgo < 4) {
      return `${weeksAgo} weeks ago`;
    } else {
      return new Date(timestamp).toLocaleDateString();
    }
  }
}
