/**
 * Minimal fake PluginAPI for wiring tests — captures registrations and lets
 * tests invoke tool handlers, command handlers, and event handlers directly.
 */

import type {
	AgentStartEvent,
	AgentStartResult,
	PluginAPI,
	PluginCommandContext,
	PluginCommandOptions,
	PluginToolContext,
	PluginToolDefinition,
	PluginToolResult,
	ThreadID,
} from '@ampcode/plugin'

export interface CapturedTool {
	definition: PluginToolDefinition
}

export interface CapturedCommand {
	id: string
	options: PluginCommandOptions
	handler: (ctx: PluginCommandContext) => void | Promise<void>
}

export class FakeAmp {
	tools = new Map<string, CapturedTool>()
	commands = new Map<string, CapturedCommand>()
	handlers = new Map<string, (event: never, ctx: never) => unknown>()
	disposed: (() => void | Promise<void>)[] = []
	openedUrls: string[] = []
	uploads: { data: Uint8Array | string; mimeType: string }[] = []
	logs: string[] = []
	uploadShouldFail = false

	readonly api: PluginAPI

	constructor() {
		const self = this
		this.api = {
			logger: { log: (...args: unknown[]) => self.logs.push(args.join(' ')) },
			system: {
				open: async (url: string | URL) => {
					self.openedUrls.push(String(url))
				},
				workspaceRoot: null,
				ampURL: new URL('https://ampcode.com'),
				user: null,
				executor: { kind: 'local', keepAlive: async () => ({ unsubscribe() {} }) },
			},
			attachments: {
				upload: async (input: { data: Uint8Array | string; mimeType: string }) => {
					if (self.uploadShouldFail) throw new Error('upload disabled')
					self.uploads.push(input)
					return { url: 'https://uploads.example.com/shot.png' }
				},
			},
			on: ((event: string, handler: (e: never, c: never) => unknown) => {
				self.handlers.set(event, handler)
				return { unsubscribe() {} }
			}) as PluginAPI['on'],
			registerCommand: (
				id: string,
				options: PluginCommandOptions,
				handler: (ctx: PluginCommandContext) => void | Promise<void>,
			) => {
				self.commands.set(id, { id, options, handler })
				return { unsubscribe() {}, setAvailability() {} }
			},
			registerTool: (definition: PluginToolDefinition) => {
				self.tools.set(definition.name, { definition })
				return { unsubscribe() {} }
			},
			onDispose: (cb: () => void | Promise<void>) => {
				self.disposed.push(cb)
				return { unsubscribe() {} }
			},
		} as unknown as PluginAPI
	}

	async runTool(name: string, input: Record<string, unknown> = {}): Promise<PluginToolResult | void> {
		const tool = this.tools.get(name)
		if (!tool) throw new Error(`tool not registered: ${name}`)
		const ctx = {
			ui: {
				notify: async () => {},
				input: async () => undefined,
				confirm: async () => true,
				select: async () => undefined,
			},
			logger: this.api.logger,
			thread: { id: 'T-test' as ThreadID },
		} as unknown as PluginToolContext
		return tool.definition.execute(input, ctx)
	}

	async runCommand(id: string, ctxOverride: Partial<PluginCommandContext> = {}): Promise<void> {
		const command = this.commands.get(id)
		if (!command) throw new Error(`command not registered: ${id}`)
		const notifications: string[] = []
		const ctx = {
			ui: {
				notify: async (m: string) => {
					notifications.push(m)
				},
				input: async (o: { initialValue?: string }) => this.queuedInputs.shift() ?? o.initialValue,
				confirm: async () => true,
				select: async () => undefined,
			},
			system: this.api.system,
		} as unknown as PluginCommandContext
		Object.assign(ctx, ctxOverride)
		this.lastNotifications = notifications
		await command.handler(ctx)
	}

	lastNotifications: string[] = []
	queuedInputs: string[] = []

	async runAgentStart(event: AgentStartEvent): Promise<AgentStartResult | void> {
		const handler = this.handlers.get('agent.start')
		if (!handler) throw new Error('no agent.start handler')
		return (await handler(event as never, {} as never)) as AgentStartResult | void
	}
}

export function makeAgentStartEvent(message: string): AgentStartEvent {
	return {
		thread: { id: 'T-test' as ThreadID },
		message,
		id: 1,
	}
}
