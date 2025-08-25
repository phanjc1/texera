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

import { DashboardFile } from "./dashboard-file.interface";
import { DashboardWorkflow } from "./dashboard-workflow.interface";
import { DashboardProject } from "./dashboard-project.interface";
import { DashboardDataset } from "./dashboard-dataset.interface";
import { DashboardEntry } from "./dashboard-entry";

export interface SearchResultItem {
  resourceType: "workflow" | "project" | "file" | "dataset" | "computing-unit";
  workflow?: DashboardWorkflow;
  project?: DashboardProject;
  file?: DashboardFile;
  dataset?: DashboardDataset;
}

export interface SearchResult {
  results: SearchResultItem[];
  more: boolean;
  hasMismatch?: boolean; // Indicates whether there are mismatched datasets (added for dashboard notification)
}

export interface SearchResultBatch {
  entries: DashboardEntry[];
  more: boolean;
  hasMismatch?: boolean;
}
