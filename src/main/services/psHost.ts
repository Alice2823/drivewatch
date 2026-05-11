import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'

interface QueuedCommand {
  id: string
  script: string
  resolve: (val: string) => void
  reject: (err: any) => void
}

export class PowerShellHost {
  private static instances: Map<string, PowerShellHost> = new Map()
  private process: ChildProcessWithoutNullStreams | null = null
  private commandQueue: QueuedCommand[] = []
  private currentOutput = ''
  private isProcessing = false

  private constructor() {
    this.startProcess()
  }

  public static getInstance(name: string = 'default'): PowerShellHost {
    const existing = PowerShellHost.instances.get(name)
    if (existing) {
      return existing
    }

    const instance = new PowerShellHost()
    PowerShellHost.instances.set(name, instance)
    return instance
  }

  private startProcess() {
    this.process = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '-'
    ], { windowsHide: true })

    this.process.stdout.on('data', (data: Buffer) => {
      this.currentOutput += data.toString('utf8')
      this.checkOutput()
    })

    this.process.stderr.on('data', (data: Buffer) => {
      // Often PowerShell writes warnings to stderr, we can just ignore them or log them
    })
    
    this.process.stdin.on('error', (err) => {
      console.error('[PS Host] Stdin error:', err)
      // We don't need to do much here, the 'close' event will handle restart
    })

    this.process.on('close', () => {
      console.warn('[PS Host] Process exited. Restarting...')
      this.isProcessing = false
      if (this.commandQueue.length > 0) {
        const failed = this.commandQueue.shift()
        failed?.resolve('') // Resolve empty on crash to prevent hangs
      }
      this.startProcess()
    })

    // If there were items in queue waiting, start them
    if (this.commandQueue.length > 0) {
      this.processNext()
    }
  }

  private checkOutput() {
    if (this.commandQueue.length === 0) return

    const currentTask = this.commandQueue[0]
    const endMarker = `__END_${currentTask.id}__`

    if (this.currentOutput.includes(endMarker)) {
      // Command finished
      const parts = this.currentOutput.split(endMarker)
      let result = parts[0].trim()

      // Sometimes PS prepends the command itself or extra newlines.
      this.currentOutput = parts[1] || ''
      this.commandQueue.shift()
      this.isProcessing = false

      currentTask.resolve(result)
      this.processNext()
    }
  }

  private processNext() {
    if (this.isProcessing || this.commandQueue.length === 0 || !this.process) return

    this.isProcessing = true
    const task = this.commandQueue[0]
    
    // Write command, then write marker to stdout
    if (this.process.stdin.writable) {
      try {
        this.process.stdin.write(`${task.script}\nWrite-Output "${`__END_${task.id}__`}"\n`)
      } catch (err) {
        console.error('[PS Host] Write failed:', err)
        this.isProcessing = false
        this.commandQueue.shift()
        task.resolve('')
        this.processNext()
      }
    } else {
      console.warn('[PS Host] Stdin not writable. Restarting...')
      this.isProcessing = false
      this.process?.kill() // This will trigger 'close' and restart
    }
  }

  /**
   * Executes a powershell command synchronously (via queue) in the persistent runspace.
   */
  public async execute(script: string, timeoutMs = 15000): Promise<string> {
    return new Promise((resolve) => {
      const id = randomUUID().replace(/-/g, '')
      
      let timer: NodeJS.Timeout | null = null

      const wrapResolve = (val: string) => {
        if (timer) clearTimeout(timer)
        resolve(val)
      }

      const wrapReject = (err: any) => {
        if (timer) clearTimeout(timer)
        resolve('') // Resolve empty on failure to prevent unhandled app crashes
      }

      this.commandQueue.push({ id, script, resolve: wrapResolve, reject: wrapReject })

      if (!this.isProcessing) {
        this.processNext()
      }

      timer = setTimeout(() => {
        const idx = this.commandQueue.findIndex(q => q.id === id)
        if (idx !== -1) {
          this.commandQueue.splice(idx, 1)
        }
        if (this.isProcessing && idx === 0) {
          this.isProcessing = false
          // If the active one timed out, the runspace is stuck. Restart it.
          this.process?.kill()
        }
        wrapReject(new Error('Timeout'))
      }, timeoutMs)
    })
  }
}
