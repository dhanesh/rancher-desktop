/*
Copyright © 2022 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// setCmd represents the set command
var setCmd = &cobra.Command{
	Use:   "set",
	Short: "Update selected fields in the Rancher Desktop UI and restart the backend.",
	Long:  `Update selected fields in the Rancher Desktop UI and restart the backend.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		return doSetCommand(cmd)
	},
}

func init() {
	rootCmd.AddCommand(setCmd)
	options.UpdateCommonStartAndSetCommands(setCmd)
	updateLegacyStartAndSetCommands(setCmd)
}

func updateLegacyStartAndSetCommands(cmd *cobra.Command) {
	cmd.Flags().StringVar(&options.SpecifiedSettings.Kubernetes.ContainerEngine, "container-engine", "", "Set engine to containerd or moby (aka docker).")
	cmd.Flags().BoolVar(&options.SpecifiedSettings.Kubernetes.Enabled, "kubernetes-enabled", false, "Control whether kubernetes runs in the backend.")
	cmd.Flags().StringVar(&options.SpecifiedSettings.Kubernetes.Version, "kubernetes-version", "", "Choose which version of kubernetes to run.")
	cmd.Flags().BoolVar(&options.SpecifiedSettings.Kubernetes.Options.Flannel, "flannel-enabled", true, "Control whether flannel is enabled. Use to disable flannel so you can install your own CNI.")
}

func updateLegacyFieldsForJSON(flags *pflag.FlagSet) bool {
	changedSomething := false
	if flags.Changed("container-engine") {
		options.SpecifiedSettingsForJSON.Kubernetes.ContainerEngine = &options.SpecifiedSettings.Kubernetes.ContainerEngine
		changedSomething = true
	}
	if flags.Changed("kubernetes-enabled") {
		options.SpecifiedSettingsForJSON.Kubernetes.Enabled = &options.SpecifiedSettings.Kubernetes.Enabled
		changedSomething = true
	}
	if flags.Changed("kubernetes-version") {
		options.SpecifiedSettingsForJSON.Kubernetes.Version = &options.SpecifiedSettings.Kubernetes.Version
		changedSomething = true
	}
	if flags.Changed("flannel-enabled") {
		options.SpecifiedSettingsForJSON.Kubernetes.Options.Flannel = &options.SpecifiedSettings.Kubernetes.Options.Flannel
		changedSomething = true
	}
	return changedSomething
}

func doSetCommand(cmd *cobra.Command) error {
	changedASharedField := options.UpdateFieldsForJSON(cmd.Flags())
	changedALegacyField := updateLegacyFieldsForJSON(cmd.Flags())
	if !changedASharedField && !changedALegacyField {
		return fmt.Errorf("%s command: no settings to change were given", cmd.Name())
	}
	cmd.SilenceUsage = true
	jsonBuffer, err := json.Marshal(options.SpecifiedSettingsForJSON)
	if err != nil {
		return err
	}

	result, err := processRequestForUtility(doRequestWithPayload("PUT", versionCommand("", "settings"), bytes.NewBuffer(jsonBuffer)))
	if err != nil {
		return err
	}
	if len(result) > 0 {
		fmt.Printf("Status: %s.\n", string(result))
	} else {
		fmt.Printf("Operation successfully returned with no output.")
	}
	return nil
}
