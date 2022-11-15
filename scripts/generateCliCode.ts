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

/**
 * This script generates the options module used for the `set` and `start` subcommands,
 * according to the preferences spec from pkg/rancher-desktop/assets/specs/command-api.yaml
 */

'use strict';

import fs from 'fs';
import path from 'path';

import yaml from 'yaml';

interface commandType {
    flagType: string;
    flagName: string;
    flagOption: string;
    defaultValue: string;
    usageNote: string;
    miscNote: string;
}

type yamlObject = any; // Record<string, string|boolean|number|Record<string, any>>;

type serverSettingsType = Record<string, Record<'type'|'directive', string|Record<string, any>>>;

function assert(predicate: boolean, error: string) {
  if (!predicate) {
    throw new Error(error);
  }
}

function capitalize(s: string) {
  return s[0].toUpperCase() + s.substring(1);
}

function capitalizeParts(s: string) {
  return s.split('.').map(capitalize).join('.');
}

function lastName(s: string): string {
  return s.split('.').pop() ?? '';
}

function uncapitalize(s: string) {
  return s[0].toLowerCase() + s.substring(1);
}

class Generator {
  constructor() {
    this.serverSettings = {};
    this.updateCommonStartAndSetCommands = [];
    this.fieldsToUpdate = [];
  }

  serverSettings: Record<string, any>;
  updateCommonStartAndSetCommands: Array<commandType>;
  fieldsToUpdate: Array<[string, string, string]>;

  protected async loadInput(inputFile: string): Promise<string> {
    const contents = (await fs.promises.readFile(inputFile)).toString();

    try {
      return yaml.parse(contents);
    } catch (e) {
      console.error(`Can't parse input file ${ inputFile }\n${ contents }\n\nError: ${ e }`, e);
      throw (e);
    }
  }

  protected generateOutput(obj: yamlObject, inputFile: string): void {
    const preferences = obj.components.schemas.preferences;

    if (!preferences) {
      throw new Error(`Can't find components.schemas.preferences in ${ inputFile }`);
    }
    assert(preferences.type === 'object', `Expected preferences.type = 'object', got ${ preferences.type }`);
    assert(Object.keys(preferences.properties).length > 0, `Not a properties object: ${ preferences.properties }`);
    for (const propertyName of Object.keys(preferences.properties)) {
      this.walkProperty(propertyName, preferences.properties[propertyName], this.serverSettings);
    }
  }

  protected async emitOutput(outputFile: string): Promise<void> {
    let fd: any; // fs.WriteStream|fs.WriteStream & { fd: 1 };

    if (outputFile !== '-') {
      const parent = path.dirname(outputFile);

      try {
        await fs.promises.access(parent, fs.constants.W_OK | fs.constants.X_OK);
      } catch (ex: any) {
        if (ex.code === 'ENOENT') {
          console.log(`Creating directory ${ parent }...`);
          await fs.promises.mkdir(parent, { recursive: true });
        } else {
          throw ex;
        }
      }
      fd = fs.createWriteStream(outputFile, {
        encoding: 'utf8',
        mode:     0o600,
      });
    } else {
      fd = process.stdout;
    }

    fd.write(copyrightBlock);
    fd.write(howGeneratedBlock);
    fd.write(`
package options

import (
\t"strconv"

\t"github.com/spf13/cobra"
\t"github.com/spf13/pflag"
)

type serverSettingsForJSON struct {
`);
    this.emitServerSettingsForJSON(fd, this.serverSettings, '\t');
    fd.write(`}

var SpecifiedSettingsForJSON serverSettingsForJSON

type serverSettings struct {
`);
    this.emitServerSettingsWithoutJSON(fd, this.serverSettings, '\t');
    fd.write(`}

var SpecifiedSettings serverSettings

`);
    this.emitOptionsSpecifications(fd, 'UpdateCommonStartAndSetCommands');
    this.emitYamlStructUpdates(fd, 'UpdateFieldsForJSON');
    this.emitStartCommandLineArgsBuilder(fd, 'GetCommandLineArgsForStartCommand');
    if (outputFile !== '-') {
      fd.close();
    }
  }

  protected emitServerSettingsForJSON(fd: fs.WriteStream, settings: Record<string, any>, indent: string): void {
    for (const propertyName in settings) {
      this.emitServerSettingsForJSONProperty(fd, propertyName, settings[propertyName], indent);
    }
  }

  protected emitServerSettingsForJSONProperty(fd: fs.WriteStream, propertyName: string, settings: Record<string, any>, indent: string) {
    fd.write(`${ indent }${ propertyName } `);
    if (typeof (settings.type) === 'object') {
      fd.write(`struct {\n`);
      this.emitServerSettingsForJSON(fd, settings.type, `${ indent }\t`);
      fd.write(`${ indent }} \`json:"${ uncapitalize(propertyName) }"\`\n`);
    } else {
      fd.write(`*${ settings.type } \`json:"${ uncapitalize(propertyName) },omitempty"\`\n`);
    }
  }

  protected emitServerSettingsWithoutJSON(fd: fs.WriteStream, settings: Record<string, any>, indent: string): void {
    for (const propertyName in settings) {
      this.emitServerSettingsPropertyWithoutJSON(fd, propertyName, settings[propertyName], indent);
    }
  }

  protected emitServerSettingsPropertyWithoutJSON(fd: fs.WriteStream, propertyName: string, settings: Record<string, any>, indent: string) {
    fd.write(`${ indent }${ propertyName } `);
    if (typeof (settings.type) === 'object') {
      fd.write(`struct {\n`);
      this.emitServerSettingsWithoutJSON(fd, settings.type, `${ indent }\t`);
      fd.write(`${ indent }}\n`);
    } else {
      fd.write(`${ settings.type }\n`);
    }
  }

  protected emitOptionsSpecifications(fd: fs.WriteStream, functionName: string): void {
    fd.write(`func ${ functionName }(cmd *cobra.Command) {
`);
    for (const command of this.updateCommonStartAndSetCommands) {
      fd.write(`\tcmd.Flags().${ command.flagType }Var(&SpecifiedSettings.${ command.flagName }, "${ command.flagOption }", ${ command.defaultValue }, "${ command.usageNote }")\n`);
    }
    fd.write(`}

`);
  }

  protected emitYamlStructUpdates(fd: fs.WriteStream, functionName: string): void {
    fd.write(`func ${ functionName }(flags *pflag.FlagSet) bool {
\tchangedSomething := false
`);
    for (const [propertyName, capitalizedName] of this.fieldsToUpdate) {
      fd.write(`\tif flags.Changed("${ propertyName }") {
\t\tSpecifiedSettingsForJSON.${ capitalizedName } = &SpecifiedSettings.${ capitalizedName }
\t\tchangedSomething = true
\t}
`);
    }
    fd.write(`\treturn changedSomething
}
`);
  }

  protected emitStartCommandLineArgsBuilder(fd: fs.WriteStream, functionName: string): void {
    fd.write(`func ${ functionName }(flags *pflag.FlagSet) []string {
\tvar commandLineArgs []string
`);
    for (const [propertyName, capitalizedName, lcTypeName] of this.fieldsToUpdate) {
      fd.write(`\tif flags.Changed("${ propertyName }") {\n`);
      fd.write(`\t\tcommandLineArgs = append(commandLineArgs, "--${ propertyName }"`);
      switch (lcTypeName) {
      case 'bool':
        fd.write(`+"="+strconv.FormatBool(SpecifiedSettings.${ capitalizedName })`);
        break;
      case 'int':
        fd.write(`, strconv.Itoa(SpecifiedSettings.${ capitalizedName })`);
        break;
      default:
        fd.write(`, SpecifiedSettings.${ capitalizedName }`);
      }
      fd.write(`)
\t}
`);
    }
    fd.write(`\treturn commandLineArgs
}
`);
  }

  protected walkProperty(propertyName: string, preference: yamlObject, serverSettings: yamlObject): void {
    switch (preference.type) {
    case 'object':
      return this.walkPropertyObject(propertyName, preference, serverSettings);
    case 'boolean':
      return this.walkPropertyBoolean(propertyName, preference, serverSettings);
    case 'string':
      return this.walkPropertyString(propertyName, preference, serverSettings);
    case 'integer':
      return this.walkPropertyInteger(propertyName, preference, serverSettings);
    case 'array':
      return this.walkPropertyArray(propertyName);
    }
  }

  protected walkPropertyObject(
    propertyName: string,
    preference: yamlObject,
    serverSettings: serverSettingsType): void {
    if (preference.additionalProperties) {
      console.log(`Skipping ${ propertyName }: not settable from the command-line.`);

      return;
    }
    const properties = preference.properties;

    assert(Object.keys(properties).length > 0, `Not a properties object: ${ properties }`);
    const innerSetting: serverSettingsType = {};
    const lastUCName = capitalize(lastName(propertyName));
    const lastLCName = uncapitalize(lastUCName);

    for (const innerName in properties) {
      this.walkProperty(`${ propertyName }.${ innerName }`, properties[innerName], innerSetting);
    }
    serverSettings[lastUCName] = { type: innerSetting, directive: `json:"${ lastLCName },omitempty"` };
  }

  protected walkPropertyString(
    propertyName: string,
    preference: yamlObject,
    serverSettings: serverSettingsType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'string', 'String', '""',
      serverSettings);
  }

  protected walkPropertyInteger(
    propertyName: string,
    preference: yamlObject,
    serverSettings: serverSettingsType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'int', 'Int', '0',
      serverSettings);
  }

  protected walkPropertyBoolean(
    propertyName: string,
    preference: yamlObject,
    serverSettings: serverSettingsType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'bool', 'Bool', 'false',
      serverSettings);
  }

  protected updateLeaf(propertyName: string, capitalizedName: string,
    lcTypeName: string, capTypeName: string,
    defaultValue: string, serverSettings: serverSettingsType) {
    const lastUCName = capitalize(lastName(propertyName));
    const lastLCName = uncapitalize(lastUCName);

    serverSettings[lastUCName] = { type: lcTypeName, directive: `json:"${ lastLCName },omitempty"` };
    this.updateCommonStartAndSetCommands.push({
      flagType:   capTypeName,
      flagName:   capitalizedName,
      flagOption: propertyName,
      defaultValue,
      usageNote:  '',
      miscNote:   '',
    });
    this.fieldsToUpdate.push([propertyName, capitalizedName, lcTypeName]);
  }

  protected walkPropertyArray(propertyName: string): void {
    console.log(`Not generating a CLI entry for property ${ propertyName }: arrays not supported.`);
  }

  async run(argv: string[]): Promise<void> {
    if (argv.length < 1) {
      throw new Error(`Not enough arguments: [${ argv.join(' ') }]; Usage: scriptFile inputFile [outputFile]`);
    }
    const obj = await this.loadInput(argv[0]);

    this.generateOutput(obj, argv[0]);
    await this.emitOutput(argv[1] ?? '-');
  }
}

const idx = process.argv.findIndex(node => node.endsWith('generateCliCode.ts'));

if (idx === -1) {
  console.error("Can't find generateCliCode.ts in argv ", process.argv);
  process.exit(1);
}
(new Generator()).run(process.argv.slice(idx + 1)).catch((e) => {
  console.error(e);
  process.exit(1);
});

const howGeneratedBlock = `/*** AUTO-GENERATED CODE!!!!
 * To rebuild this file, run
 * npm run generate:cli pkg/rancher-desktop/assets/specs/command-api.yaml src/go/rdctl/cmd/options.go
 *
 */

`;

const copyrightBlock = `/*
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

`;
