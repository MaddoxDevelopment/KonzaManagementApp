/* eslint global-require: off, no-console: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./app/main.prod.js` using webpack. This gives us some performance wins.
 */
import {app, BrowserWindow, dialog} from 'electron';
import {autoUpdater} from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
import {dispatchToWindow, Event, EventMap} from "./events/events";
import {ServiceRegistry} from "./services/infrastructure/serviceRegistry";

const { ipcMain } = require('electron')

export default class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];

  return Promise.all(
    extensions.map(name => installer.default(installer[name], forceDownload))
  ).catch(console.log);
};

const createWindow = async () => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    fullscreen: false,
    webPreferences: {
      nodeIntegration: true
    }
  });

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update.');
  })
  autoUpdater.on('update-available', (info) => {
    const dialogOpts = {
      type: 'info',
      buttons: ['OK'],
      title: `Konza Pizza Manager v${info.version}`,
      message: 'An update is available, please press OK to apply new update.',
    }
    dialog.showMessageBox(dialogOpts);
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available.', info);
  })

  autoUpdater.on('error', (err) => {
    const dialogOpts = {
      type: 'error',
      buttons: ['OK'],
      title: `Auto Updater Failed `,
      message: 'Please restart the application. If this continues to happen, just close the dialog and ignore.',
      detail : err.toString()
    }
    dialog.showMessageBox(dialogOpts);
    console.log('Error in auto-updater. ' + err);
  })

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    console.log(log_message);
  })

  autoUpdater.on('update-downloaded', (info) => {
    const dialogOpts = {
      type: 'info',
      buttons: ['OK'],
      title: `Konza Pizza Manager v${info.version}`,
      message: 'Update has been successfully downloaded, press OK to update and restart.',
    }
    dialog.showMessageBox(dialogOpts).then((returnValue) => {
      if (returnValue.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    })
  });

  mainWindow.loadURL(`file://${__dirname}/app.html`);

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
      //mainWindow.webContents.openDevTools({mode : 'detach'});
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const listeners = Object.entries(EventMap)

const registry = new ServiceRegistry();
listeners.forEach(e => {
  const eventEnum = e[0] as any;
  const key : any = Event[eventEnum].toString();
  const callback = e[1] as any;
  ipcMain.on(key, async (event, arg) => {
    try {
      const result = await callback(registry, event, arg);
      if(result && mainWindow) {
        dispatchToWindow(mainWindow, eventEnum, result);
      }
    } catch (e) {
      console.error(e);
      if(mainWindow) {
        dispatchToWindow(mainWindow, Event.Error, e.toString());
      }
    }
  })
});

app.on('ready', createWindow);

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindow();
});
