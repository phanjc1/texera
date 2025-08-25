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

import { Component, Input, OnInit } from "@angular/core";
import { ComputingUnitStatusService } from "../../../../workspace/service/computing-unit-status/computing-unit-status.service";
import { DashboardEntry } from "../../../type/dashboard-entry";
import { DashboardWorkflowComputingUnit, WorkflowComputingUnitType } from "../../../../workspace/types/workflow-computing-unit";
import { extractErrorMessage } from "../../../../common/util/error";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { NzModalService } from "ng-zorro-antd/modal";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { UserService } from "../../../../common/service/user/user.service";
import { WorkflowComputingUnitManagingService } from "../../../../workspace/service/workflow-computing-unit/workflow-computing-unit-managing.service";
import {
  parseResourceUnit,
  parseResourceNumber,
  findNearestValidStep,
  unitTypeMessageTemplate
} from "../../../../common/util/computing-unit.util";

@UntilDestroy()
@Component({
  selector: "texera-computing-unit-section",
  templateUrl: "user-computing-unit.component.html",
  styleUrls: ["user-computing-unit.component.scss"],
})
export class UserComputingUnitComponent implements OnInit {
  public entries: DashboardEntry[] = [];
  public isLogin = this.userService.isLogin();
  public currentUid = this.userService.getCurrentUser()?.uid;
  @Input() editable = false;

  allComputingUnits: DashboardWorkflowComputingUnit[] = [];

   // variables for creating a computing unit
  addComputeUnitModalVisible = false;
  newComputingUnitName: string = "";
  selectedMemory: string = "";
  selectedCpu: string = "";
  selectedGpu: string = "0"; // Default to no GPU
  selectedJvmMemorySize: string = "1G"; // Initial JVM memory size
  selectedComputingUnitType?: WorkflowComputingUnitType; // Selected computing unit type
  selectedShmSize: string = "64Mi"; // Shared memory size
  shmSizeValue: number = 64; // default to 64
  shmSizeUnit: "Mi" | "Gi" = "Mi"; // default unit
  availableComputingUnitTypes: WorkflowComputingUnitType[] = [];
  localComputingUnitUri: string = ""; // URI for local computing unit

  // JVM memory slider configuration
  jvmMemorySliderValue: number = 1; // Initial value in GB
  jvmMemoryMarks: { [key: number]: string } = { 1: "1G" };
  jvmMemoryMax: number = 1;
  jvmMemorySteps: number[] = [1]; // Available steps in binary progression (1,2,4,8...)
  showJvmMemorySlider: boolean = false; // Whether to show the slider

  // cpu&memory limit options from backend
  cpuOptions: string[] = [];
  memoryOptions: string[] = [];
  gpuOptions: string[] = []; // Add GPU options array

  constructor(
    private notificationService: NotificationService,
    private modalService: NzModalService,
    private userService: UserService,
    private computingUnitService: WorkflowComputingUnitManagingService,
    private computingUnitStatusService: ComputingUnitStatusService
  ) {
    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.isLogin = this.userService.isLogin();
        this.currentUid = this.userService.getCurrentUser()?.uid;
      });
  }

  ngOnInit() {
    this.newComputingUnitName = "My Computing Unit";
    this.computingUnitService
      .getComputingUnitTypes()
      .pipe(untilDestroyed(this))
      .subscribe({
        next: ({ typeOptions }) => {
          this.availableComputingUnitTypes = typeOptions;
          // Set default selected type if available
          if (typeOptions.includes("kubernetes")) {
            this.selectedComputingUnitType = "kubernetes";
          } else if (typeOptions.length > 0) {
            this.selectedComputingUnitType = typeOptions[0];
          }
        },
        error: (err: unknown) =>
          this.notificationService.error(`Failed to fetch computing unit types: ${extractErrorMessage(err)}`),
      });

    this.computingUnitService
      .getComputingUnitLimitOptions()
      .pipe(untilDestroyed(this))
      .subscribe({
        next: ({ cpuLimitOptions, memoryLimitOptions, gpuLimitOptions }) => {
          this.cpuOptions = cpuLimitOptions;
          this.memoryOptions = memoryLimitOptions;
          this.gpuOptions = gpuLimitOptions;

          // fallback defaults
          this.selectedCpu = this.cpuOptions[0] ?? "1";
          this.selectedMemory = this.memoryOptions[0] ?? "1Gi";
          this.selectedGpu = this.gpuOptions[0] ?? "0";

          // Initialize JVM memory slider based on selected memory
          this.updateJvmMemorySlider();
        },
        error: (err: unknown) =>
          this.notificationService.error(`Failed to fetch resource options: ${extractErrorMessage(err)}`),
      });

    this.computingUnitStatusService
      .getAllComputingUnits()
      .pipe(untilDestroyed(this))
      .subscribe(units => {
        this.allComputingUnits = units;
        this.entries = units.map(u => new DashboardEntry(u));
      });
  }

  terminateComputingUnit(cuid: number): void {
    const unit = this.allComputingUnits.find(u => u.computingUnit.cuid === cuid);

    if (!unit || !unit.computingUnit.uri) {
      this.notificationService.error("Invalid computing unit.");
      return;
    }

    const unitName = unit.computingUnit.name;
    const unitType = unit?.computingUnit.type || "kubernetes"; // fallback
    const templates = unitTypeMessageTemplate[unitType];

    // Show confirmation modal
    this.modalService.confirm({
      nzTitle: templates.terminateTitle,
      nzContent: templates.terminateWarning
        ? `
      <p>Are you sure you want to terminate <strong>${unitName}</strong>?</p>
      ${templates.terminateWarning}
    `
        : `
      <p>Are you sure you want to disconnect from <strong>${unitName}</strong>?</p>
    `,
      nzOkText: unitType === "local" ? "Disconnect" : "Terminate",
      nzOkType: "primary",
      nzOnOk: () => {
        // Use the ComputingUnitStatusService to handle termination
        // This will properly close the websocket before terminating the unit
        this.computingUnitStatusService
          .terminateComputingUnit(cuid)
          .pipe(untilDestroyed(this))
          .subscribe({
            next: (success: boolean) => {
              if (success) {
                this.notificationService.success(`Terminated Computing Unit: ${unitName}`);
              } else {
                this.notificationService.error("Failed to terminate computing unit");
              }
            },
            error: (err: unknown) => {
              this.notificationService.error(`Failed to terminate computing unit: ${extractErrorMessage(err)}`);
            },
          });
      },
      nzCancelText: "Cancel",
    });
  }

  startComputingUnit(): void {
    // Validate based on computing unit type
    if (this.selectedComputingUnitType === "kubernetes") {
      if (this.newComputingUnitName.trim() == "") {
        this.notificationService.error("Name of the computing unit cannot be empty");
        return;
      }

      this.selectedShmSize = `${this.shmSizeValue}${this.shmSizeUnit}`;

      this.computingUnitService
        .createKubernetesBasedComputingUnit(
          this.newComputingUnitName,
          this.selectedCpu,
          this.selectedMemory,
          this.selectedGpu,
          this.selectedJvmMemorySize,
          this.selectedShmSize
        )
        .pipe(untilDestroyed(this))
        .subscribe({
          next: () => {
            this.notificationService.success("Successfully created the new Kubernetes compute unit");
            this.computingUnitStatusService.refreshComputingUnitList();
          },
          error: (err: unknown) =>
            this.notificationService.error(`Failed to start Kubernetes computing unit: ${extractErrorMessage(err)}`),
        });
    } else if (this.selectedComputingUnitType === "local") {
      // For local computing units, validate the URI
      if (!this.localComputingUnitUri || this.localComputingUnitUri.trim() === "") {
        this.notificationService.error("URI for local computing unit cannot be empty");
        return;
      }

      this.computingUnitService
        .createLocalComputingUnit(this.newComputingUnitName, this.localComputingUnitUri)
        .pipe(untilDestroyed(this))
        .subscribe({
          next: () => {
            this.notificationService.success("Successfully created the new local compute unit");
            this.computingUnitStatusService.refreshComputingUnitList();
          },
          error: (err: unknown) =>
            this.notificationService.error(`Failed to start local computing unit: ${extractErrorMessage(err)}`),
        });
    } else {
      this.notificationService.error("Please select a valid computing unit type");
    }
  }

  showGpuSelection(): boolean {
    // Don't show GPU selection if there are no options or only "0" option
    return this.gpuOptions.length > 1 || (this.gpuOptions.length === 1 && this.gpuOptions[0] !== "0");
  }

  showAddComputeUnitModalVisible(): void {
    this.addComputeUnitModalVisible = true;
  }

  handleAddComputeUnitModalOk(): void {
    this.startComputingUnit();
    this.addComputeUnitModalVisible = false;
  }

  handleAddComputeUnitModalCancel(): void {
    this.addComputeUnitModalVisible = false;
  }

  isShmTooLarge(): boolean {
    const total = parseResourceNumber(this.selectedMemory);
    const unit = parseResourceUnit(this.selectedMemory);
    const memoryInMi = unit === "Gi" ? total * 1024 : total;
    const shmInMi = this.shmSizeUnit === "Gi" ? this.shmSizeValue * 1024 : this.shmSizeValue;

    return shmInMi > memoryInMi;
  }

  updateJvmMemorySlider(): void {
    this.resetJvmMemorySlider();
  }

  onJvmMemorySliderChange(value: number): void {
    // Ensure the value is one of the valid steps
    const validStep = findNearestValidStep(value, this.jvmMemorySteps);
    this.jvmMemorySliderValue = validStep;
    this.selectedJvmMemorySize = `${validStep}G`;
  }

  isMaxJvmMemorySelected(): boolean {
    // Only show warning for larger memory sizes (>=4GB) where the slider is shown
    // AND when the maximum value is selected
    return this.showJvmMemorySlider && this.jvmMemorySliderValue === this.jvmMemoryMax && this.jvmMemoryMax >= 4;
  }

  // Completely reset the JVM memory slider based on the selected CU memory
  resetJvmMemorySlider(): void {
    // Parse memory limit to determine max JVM memory
    const memoryValue = parseResourceNumber(this.selectedMemory);
    const memoryUnit = parseResourceUnit(this.selectedMemory);

    // Set max JVM memory to the total memory selected (in GB)
    let cuMemoryInGb = 1; // Default to 1GB
    if (memoryUnit === "Gi") {
      cuMemoryInGb = memoryValue;
    } else if (memoryUnit === "Mi") {
      cuMemoryInGb = Math.max(1, Math.floor(memoryValue / 1024));
    }

    this.jvmMemoryMax = cuMemoryInGb;

    // Special cases for smaller memory sizes (1-3GB)
    if (cuMemoryInGb <= 3) {
      // Don't show slider for small memory sizes
      this.showJvmMemorySlider = false;

      // Set JVM memory size to 1GB when CU memory is 1GB, otherwise set to 2GB
      if (cuMemoryInGb === 1) {
        this.jvmMemorySliderValue = 1;
        this.selectedJvmMemorySize = "1G";
      } else {
        // For 2-3GB instances, use 2GB for JVM
        this.jvmMemorySliderValue = 2;
        this.selectedJvmMemorySize = "2G";
      }

      // Still calculate steps for completeness
      this.jvmMemorySteps = [];
      let value = 1;
      while (value <= this.jvmMemoryMax) {
        this.jvmMemorySteps.push(value);
        value = value * 2;
      }

      // Update marks
      this.jvmMemoryMarks = {};
      this.jvmMemorySteps.forEach(step => {
        this.jvmMemoryMarks[step] = `${step}G`;
      });

      return;
    }

    // For larger memory sizes (4GB+), show the slider
    this.showJvmMemorySlider = true;

    // Calculate binary steps (2,4,8,...) starting from 2GB
    this.jvmMemorySteps = [];
    let value = 2; // Start from 2GB for larger instances
    while (value <= this.jvmMemoryMax) {
      this.jvmMemorySteps.push(value);
      value = value * 2;
    }

    // Update slider marks
    this.jvmMemoryMarks = {};
    this.jvmMemorySteps.forEach(step => {
      this.jvmMemoryMarks[step] = `${step}G`;
    });

    // Always default to 2GB for larger memory sizes
    this.jvmMemorySliderValue = 2;
    this.selectedJvmMemorySize = "2G";
  }

  onMemorySelectionChange(): void {
    // Store current JVM memory value for potential reuse
    const previousJvmMemory = this.jvmMemorySliderValue;

    // Reset slider configuration based on the new memory selection
    this.resetJvmMemorySlider();

    // For CU memory > 3GB, preserve previous value if valid and >= 2GB
    // Get the current memory in GB
    const memoryValue = parseResourceNumber(this.selectedMemory);
    const memoryUnit = parseResourceUnit(this.selectedMemory);
    let cuMemoryInGb = memoryUnit === "Gi" ? memoryValue : memoryUnit === "Mi" ? Math.floor(memoryValue / 1024) : 1;

    // Only try to preserve previous value for larger memory sizes where slider is shown
    if (
      cuMemoryInGb > 3 &&
      previousJvmMemory >= 2 &&
      previousJvmMemory <= this.jvmMemoryMax &&
      this.jvmMemorySteps.includes(previousJvmMemory)
    ) {
      this.jvmMemorySliderValue = previousJvmMemory;
      this.selectedJvmMemorySize = `${previousJvmMemory}G`;
    }
  }

  getCreateModalTitle(): string {
    if (!this.selectedComputingUnitType) return "Create Computing Unit";
    return unitTypeMessageTemplate[this.selectedComputingUnitType].createTitle;
  }
}
