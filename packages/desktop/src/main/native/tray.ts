import { app, Menu, nativeImage, Tray } from "electron"
import { Effect, Path } from "effect"
import { ApplicationLifecycle } from "../lifecycle"
import { DesktopPaths } from "../paths"
import { BackgroundService } from "../service/background-service"
import { setAppQuitting } from "../windows"
import { nativeT, onNativeTranslations } from "./translations"

// Shows the background service the app started or adopted. While it is up, quitting the app only
// closes its windows (and, on macOS, its Dock icon), so the service never runs without a visible owner.
export const installTray = Effect.fn("Tray.install")(function* () {
  const lifecycle = yield* ApplicationLifecycle.Service
  const service = yield* BackgroundService.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  const icon = yield* trayIcon

  yield* service.connection
  const tray = new Tray(icon)

  const quit = () => {
    setAppQuitting()
    runFork(
      service.stop.pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.logError("stopping the background service timed out, quitting anyway"),
        }),
        Effect.ensuring(Effect.sync(() => app.quit())),
      ),
    )
  }

  const update = () => {
    tray.setToolTip(nativeT("desktop.tray.status"))
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: nativeT("desktop.tray.status"), enabled: false },
        { type: "separator" },
        { label: nativeT("desktop.tray.open"), click: lifecycle.reopen },
        { type: "separator" },
        { label: nativeT("desktop.tray.quit"), click: quit },
      ]),
    )
  }

  update()

  // Windows and Linux trays open the app on click; a macOS menu bar item opens its menu.
  if (process.platform !== "darwin") tray.on("click", lifecycle.reopen)
  const offTranslations = onNativeTranslations(update)
  lifecycle.keepRunningOnQuit(true)

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      lifecycle.keepRunningOnQuit(false)
      offTranslations()
      tray.destroy()
    }),
  )
})

const trayIcon = Effect.gen(function* () {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const resources = app.isPackaged ? path.join(app.getAppPath(), "resources") : paths.developmentResourcesRoot

  // A template image is drawn in the menu bar's own color, so it follows light and dark menu bars.
  if (process.platform === "darwin") {
    const icon = nativeImage.createFromPath(path.join(resources, "icons", "trayTemplate.png"))
    icon.setTemplateImage(true)

    return icon
  }

  if (process.platform === "win32") return nativeImage.createFromPath(path.join(resources, "icons", "icon.ico"))

  return nativeImage.createFromPath(path.join(resources, "icons", "icon.png")).resize({ width: 32, height: 32 })
})
