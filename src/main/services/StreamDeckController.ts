import { listStreamDecks, openStreamDeck } from '@elgato-stream-deck/node'
import type { StreamDeck } from '@elgato-stream-deck/node'
import { LightingService } from './LightingService'

export class StreamDeckController implements LightingService {
    private constructor(private readonly deck: StreamDeck) {}

    static async connect(): Promise<StreamDeckController | null> {
        const devices = await listStreamDecks()
        if (devices.length === 0) return null

        const deck = await openStreamDeck(devices[0].path)
        return new StreamDeckController(deck)
    }

    async fillKeyColor(keyIndex: number, r: number, g: number, b: number): Promise<void> {
        await this.deck.fillKeyColor(keyIndex, r, g, b)
    }

    async fillKeyImage(keyIndex: number, imageBuffer: Buffer): Promise<void> {
        await this.deck.fillKeyBuffer(keyIndex, imageBuffer, { format: 'rgba' })
    }

    async setSolidColor(r: number, g: number, b: number): Promise<void> {
        const dimensions = this.deck.calculateFillPanelDimensions()
        if (!dimensions) return

        const pixelCount = dimensions.width * dimensions.height
        const buffer = Buffer.alloc(pixelCount * 3)
        for (let i = 0; i < pixelCount; i++) {
            buffer[i * 3] = r
            buffer[i * 3 + 1] = g
            buffer[i * 3 + 2] = b
        }

        await this.deck.fillPanelBuffer(buffer, { format: 'rgb' })
    }

    async clearPanel(): Promise<void> {
        await this.deck.clearPanel()
    }

    async setBrightness(percentage: number): Promise<void> {
        await this.deck.setBrightness(percentage)
    }

    async disconnect(): Promise<void> {
        await this.deck.close()
    }
}
