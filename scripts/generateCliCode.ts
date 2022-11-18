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

import ejs from 'ejs';
import yaml from 'yaml';

interface commandType {
    flagType: string;
    flagName: string;
    flagOption: string;
    defaultValue: string;
    usageNote: string;
    miscNote: string;
    aliasFor: string;
    enums: string[] | undefined;
}

interface commandLineOptionFields {
  propertyName: string;
  capitalizedName: string;
  lcTypeName: string;
  aliasFor: string;
  enums: string[] | undefined;
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
  fieldsToUpdate: Array<commandLineOptionFields>;

  protected async loadInput(inputFile: string): Promise<string> {
    const contents = (await fs.promises.readFile(inputFile)).toString();

    try {
      return yaml.parse(contents);
    } catch (e) {
      console.error(`Can't parse input file ${ inputFile }\n${ contents }\n\nError: ${ e }`, e);
      throw (e);
    }
  }

  protected processInput(obj: yamlObject, inputFile: string): void {
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

  protected emitOutput(outputFile: string): void {
    const options = { rmWhitespace: false };
    const templateFile = 'scripts/assets/options.go.templ';
    const data: Record<string, any> = {
      serverSettings:                  this.serverSettings,
      updateCommonStartAndSetCommands: this.updateCommonStartAndSetCommands,
      fieldsToUpdate:                  this.fieldsToUpdate,
    };

    ejs.renderFile(templateFile, data, options).then(async(renderedContent: string) => {
      if (outputFile === '-') {
        console.log(renderedContent);
      } else {
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
        await fs.promises.writeFile(outputFile, renderedContent);
      }
    }).catch((err: any) => {
      console.error(err);
    });
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
      preference,
      serverSettings);
  }

  protected walkPropertyInteger(
    propertyName: string,
    preference: yamlObject,
    serverSettings: serverSettingsType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'int', 'Int', '0',
      preference,
      serverSettings);
  }

  protected walkPropertyBoolean(
    propertyName: string,
    preference: yamlObject,
    serverSettings: serverSettingsType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'bool', 'Bool', 'false',
      preference,
      serverSettings);
  }

  protected updateLeaf(propertyName: string, capitalizedName: string,
    lcTypeName: string, capTypeName: string,
    defaultValue: string, preference: yamlObject,
    serverSettings: serverSettingsType) {
    const lastUCName = capitalize(lastName(propertyName));
    const lastLCName = uncapitalize(lastUCName);
    const newCommand: yamlObject = {
      flagType:   capTypeName,
      flagName:   capitalizedName,
      flagOption: propertyName,
      defaultValue,
      usageNote:  preference.usage ?? '',
      miscNote:   '',
      aliasFor:   '',
      enums:      preference.enum,
    };

    serverSettings[lastUCName] = { type: lcTypeName, directive: `json:"${ lastLCName },omitempty"` };
    this.updateCommonStartAndSetCommands.push(newCommand);
    this.fieldsToUpdate.push({
      propertyName,
      capitalizedName,
      lcTypeName,
      aliasFor: '',
      enums:      preference.enum,
    });
    for (const alias of preference.aliases ?? []) {
      this.updateCommonStartAndSetCommands.push(Object.assign({}, newCommand, { flagOption: alias, aliasFor: propertyName }));
      this.fieldsToUpdate.push({
        propertyName: alias,
        capitalizedName,
        lcTypeName,
        aliasFor:     propertyName,
        enums:        preference.enum,
      });
    }
  }

  protected walkPropertyArray(propertyName: string): void {
    console.log(`Not generating a CLI entry for property ${ propertyName }: arrays not supported.`);
  }

  async run(argv: string[]): Promise<void> {
    if (argv.length < 1) {
      throw new Error(`Not enough arguments: [${ argv.join(' ') }]; Usage: scriptFile inputFile [outputFile]`);
    }
    const obj = await this.loadInput(argv[0]);

    this.processInput(obj, argv[0]);
    this.emitOutput(argv[1] ?? '-');
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
