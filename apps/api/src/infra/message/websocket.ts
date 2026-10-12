import { DurableObject } from 'cloudflare:workers'

interface SocketSerializeMetaInfo {
  uuid: string
  userId: number
  deviceId: number
  connectType: 'extensions' | 'web'
}

interface BookmarkChangeVO {
  user_id: number
  bookmark_id: number
  created_at: Date
  target_url: string
  action: 'add' | 'delete' | 'update'
}

export class SlaxWebSocketServer extends DurableObject {
  private sessions: Map<string, WebSocket> = new Map()
  private extensionSession: Map<string, Set<WebSocket>> = new Map()

  constructor(
    state: DurableObjectState,
    public env: Env
  ) {
    super(state, env)

    const sockets = state.getWebSockets()
    if (!!sockets && sockets.length > 0) {
      sockets.forEach(ws => {
        if (!ws) return
        const meta = ws.deserializeAttachment() as SocketSerializeMetaInfo
        if (!meta) return

        if (meta.connectType === 'extensions') {
          if (!this.extensionSession.has(meta.userId.toString())) {
            this.extensionSession.set(meta.userId.toString(), new Set())
          }

          this.extensionSession.get(meta.userId.toString())?.add(ws)
        } else {
          this.sessions.set(meta.uuid, ws)
        }
      })
    }

    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request) {
    const uuid = request.headers.get('uuid')
    const userId = parseInt(request.headers.get('user_id') || '0')
    const region = request.headers.get('region')
    const deviceId = parseInt(request.headers.get('device_id') || '0')
    const connectType = (request.headers.get('connect_type') as SocketSerializeMetaInfo['connectType']) || 'web'

    if (!uuid || !Number.isSafeInteger(userId) || userId < 1 || !region) return new Response(null, { status: 400, statusText: 'uuid not found' })
    if (!(await this.isActive(userId))) return new Response(null, { status: 401 })
    // 创建websocket连接
    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)
    // 休眠
    this.ctx.acceptWebSocket(server)

    // 维护session
    if (connectType === 'extensions') {
      if (!this.extensionSession.has(userId.toString())) {
        this.extensionSession.set(userId.toString(), new Set())
      }

      this.extensionSession.get(userId.toString())?.add(server)
    } else {
      this.sessions.set(uuid, server)
    }

    // 标记
    server.serializeAttachment({ userId, uuid, deviceId, connectType })

    return new Response(null, {
      status: 101,
      webSocket: client
    })
  }

  private async isActive(userId: number): Promise<boolean> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.env.HYPERDRIVE.connectionString })
    try {
      await client.connect()
      const result = await client.query('SELECT id, CURRENT_TIMESTAMP AS checked_at FROM sr_user WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [userId])
      if (result.rows.length === 1) return true
    } catch (error) {
      console.error('WebSocket identity check failed', error)
    } finally {
      try {
        await client.end()
      } catch (error) {
        console.error('WebSocket identity connection cleanup failed', error)
      }
    }
    await this.revokeUser(userId)
    return false
  }

  async revokeUser(userId: number): Promise<void> {
    const sockets = new Set([...this.sessions.values(), ...(this.extensionSession.get(String(userId)) || [])])
    const cleanups: Promise<void>[] = []
    for (const ws of sockets) {
      if ((ws.deserializeAttachment() as SocketSerializeMetaInfo)?.userId !== userId) continue
      try {
        ws.close(1008, 'Account unavailable')
      } catch (error) {
        console.error('WebSocket close failed', error)
      } finally {
        cleanups.push(this.removeSocket(ws))
      }
    }
    await Promise.all(cleanups)
  }

  async sendReminder(token: string, unreadCount: number) {
    if (!this.sessions || this.sessions == null || this.sessions.size === 0) {
      console.log('no websocket sessions')
      return false
    }
    const ws = this.sessions.get(token)
    if (!ws) {
      console.log('websocket not found', token)
      return false
    }
    try {
      if (!(await this.isActive((ws.deserializeAttachment() as SocketSerializeMetaInfo).userId))) return false
      ws.send(`${JSON.stringify({ type: 'reminder', unreadCount: parseInt(unreadCount.toString()) })}`)
      return true
    } catch (e) {
      console.log('sendReminder error', e)
      return false
    }
  }

  async sendBookmarkChange(changelog: BookmarkChangeVO) {
    try {
      const { user_id, ...data } = changelog
      if (!(await this.isActive(user_id))) return
      const wsSet = this.extensionSession.get(user_id.toString())

      wsSet?.forEach(ws => {
        try {
          ws.send(`${JSON.stringify({ type: 'bookmark_changes', data })}`)
        } catch (e) {
          ws.close(1006, 'bye~')
          void this.removeSocket(ws)
        }
      })
    } catch (e) {
      console.log('sendBookmarkChange error', e)
    }
  }

  async webSocketMessage(ws: WebSocket, message: string) {}

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    try {
      ws.close(code, 'bye~')
      void this.removeSocket(ws)
    } catch (e) {
      console.log('webSocketClose error', e)
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.log('webSocketError', error)
    try {
      ws.close(1006, 'bye~')
      void this.removeSocket(ws)
    } catch (e) {
      console.log('webSocketError error', e)
    }
  }

  async getOnlineWebsocketUser() {
    return this.sessions.size
  }

  async removeSocket(ws: WebSocket) {
    const meta = ws.deserializeAttachment() as SocketSerializeMetaInfo
    if (meta.connectType === 'extensions') {
      const wsSet = this.extensionSession.get(meta.userId.toString())
      if (wsSet) {
        wsSet.delete(ws)
        if (wsSet.size === 0) {
          this.extensionSession.delete(meta.userId.toString())
        }
      }
    } else {
      this.sessions.delete(meta?.uuid)
      await this.env.DB.prepare('DELETE FROM slax_user_notice_device WHERE id = ?').bind(meta.deviceId).run()
    }
  }
}
