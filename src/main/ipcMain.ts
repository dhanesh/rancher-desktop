import Electron from 'electron';

import Logging, { Log } from '@/utils/logging';

// Intended to be passed to the replacer parameter in a JSON.stringify
// call. Should rectify any circular references that the object you are
// stringifying may have.
function removeCircularReferences(property: string | symbol, value: any): any {
  if (property === '_idlePrev') {
    return undefined;
  }

  return value;
}

export function makeArgsPrintable(args: any[]): string[] {
  const maxPrintableArgLength = 500;
  const printableArgs = args.map((arg) => {
    let printableArg = JSON.stringify(arg, removeCircularReferences);

    if (printableArg.length > maxPrintableArgLength) {
      printableArg = printableArg.slice(0, maxPrintableArgLength);
      printableArg += '...';
    }

    return printableArg;
  });

  return printableArgs;
}

export function getIpcMainProxy(logger: Log) {
  return new Proxy(Electron.ipcMain, {
    get: (target, property) => {
      if (property === 'on') {
        return (channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => void) => {
          const newListener = (event: Electron.IpcMainEvent, ...args: any[]) => {
            const printableArgs = makeArgsPrintable(args);

            logger.debug(`ipcMain: "${ channel }" triggered with arguments: ${ printableArgs.join(', ') }`);
            listener(event, ...args);
          };

          return target[property](channel, newListener);
        };
      }

      return Reflect.get(target, property);
    },
  });
}

// Renderer front-end logging

const rendererLog = Logging.renderer;

Electron.ipcMain.on('log-renderer', (event, args: any[]) => {
  if (args.length > 1) {
    const printableArgs = makeArgsPrintable(args.slice(1));

    rendererLog.log( args[0], `:  ${ printableArgs.join(', ') }` );
  } else {
    rendererLog.log( args[0], ':' );
  }
});

Electron.ipcMain.on('log-debug-renderer', (event, args: any[]) => {
  if (args.length > 1) {
    const printableArgs = makeArgsPrintable(args.slice(1));

    rendererLog.debug( args[0], `:  ${ printableArgs.join(', ') }` );
  } else {
    rendererLog.debug( args[0], ':' );
  }
});
