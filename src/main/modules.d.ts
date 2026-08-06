declare module 'screenshot-desktop' {
  interface ScreenshotOptions {
    format?: string
    screen?: number | string
    filename?: string
  }
  function screenshot(options?: ScreenshotOptions): Promise<Buffer>
  namespace screenshot {
    function listDisplays(): Promise<Array<{ id: number | string; name: string }>>
    function all(): Promise<Buffer[]>
  }
  export = screenshot
}
