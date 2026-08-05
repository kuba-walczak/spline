import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const noHooksSettingsPath = join(tmpdir(), 'jarvis-claude-settings.json')
writeFileSync(noHooksSettingsPath, JSON.stringify({ hooks: {} }))

const emptyMcpConfigPath = join(tmpdir(), 'jarvis-claude-mcp.json')
writeFileSync(emptyMcpConfigPath, JSON.stringify({ mcpServers: {} }))

interface ResultEvent {
    type: 'result'
    is_error: boolean
    result?: string
}

let child: ChildProcessWithoutNullStreams | null = null
let buffer = ''
const queue: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = []

function quoteArg(arg: string): string {
    return `"${arg.replace(/"/g, '""')}"`
}

function handleLine(line: string): void {
    if (!line.trim()) return

    const event = JSON.parse(line) as ResultEvent
    if (event.type !== 'result') return

    const pending = queue.shift()
    if (!pending) return

    if (event.is_error) {
        pending.reject(new Error(event.result ?? 'Claude request failed'))
    } else {
        pending.resolve(event.result ?? '')
    }
}

function ensureProcess(): ChildProcessWithoutNullStreams {
    if (child) return child

    const args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--allowedTools', 'WebSearch WebFetch',
        '--verbose',
        '--model', 'sonnet',
        '--effort', 'medium',
        '--settings', noHooksSettingsPath,
        '--strict-mcp-config',
        '--mcp-config', emptyMcpConfigPath
    ].map(quoteArg).join(' ')

    const proc = spawn(`claude ${args}`, { shell: true })
    proc.stdout.setEncoding('utf8')

    proc.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            handleLine(line)
        }
    })

    proc.on('exit', () => {
        child = null
        buffer = ''
        const pending = queue.splice(0)
        pending.forEach((p) => p.reject(new Error('Claude process exited')))
    })

    child = proc
    return proc
}

export function askClaude(prompt: string): Promise<string> {
    const proc = ensureProcess()

    return new Promise((resolve, reject) => {
        queue.push({ resolve, reject })

        const message = {
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: prompt }] }
        }
        proc.stdin.write(JSON.stringify(message) + '\n')
    })
}

export function stopClaude(): void {
    child?.stdin.end()
    child = null
}
