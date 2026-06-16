import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { RoomRegistry } from './rooms.js'

const PATH_RE = /^\/(recall|agent)\/([A-Za-z0-9_-]{16,})$/

export function createWorker(): { server: Server; registry: RoomRegistry } {
  const registry = new RoomRegistry()

  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`ok rooms=${registry.roomCount()}`)
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost')
    const m = pathname.match(PATH_RE)
    if (!m) {
      socket.destroy()
      return
    }
    const role = m[1] as 'recall' | 'agent'
    const token = m[2]
    wss.handleUpgrade(req, socket, head, ws => {
      const sink = {
        send: (d: string) => {
          try {
            ws.send(d)
          } catch {
            // socket closing; nothing to do
          }
        },
      }
      if (role === 'recall') {
        registry.attachRecall(token, sink)
        let logged = false
        ws.on('message', data => {
          if (!logged) {
            logged = true
            console.log(`[worker] first recall payload for ${token.slice(0, 6)}…:`, data.toString().slice(0, 300))
          }
          try {
            registry.handleRecallMessage(token, data.toString())
          } catch (e) {
            console.warn('[worker] handle error', e)
          }
        })
        ws.on('close', () => registry.detachRecall(token))
      } else {
        registry.attachAgent(token, sink)
        ws.on('close', () => registry.detachAgent(token))
      }
    })
  })

  return { server, registry }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const port = Number(process.env.PORT) || 8080
  const { server } = createWorker()
  server.listen(port, () => console.log(`[recall-video-worker] listening on :${port}`))
}
