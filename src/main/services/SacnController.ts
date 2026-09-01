import { Sender } from 'sacn'
import { LightingService } from './LightingService'

const TARGET_IP = '10.0.0.200'
const UNIVERSE = 1
const LED_COUNT = 60

export class SacnController implements LightingService {
    private constructor(private readonly sender: Sender) {}

    static async connect(): Promise<SacnController> {
        const sender = new Sender({
            universe: UNIVERSE,
            useUnicastDestination: TARGET_IP,
            defaultPacketOptions: { sourceName: 'spline', useRawDmxValues: true }
        })
        return new SacnController(sender)
    }

    async setSolidColor(r: number, g: number, b: number): Promise<void> {
        const payload: Record<number, number> = {}
        for (let i = 0; i < LED_COUNT; i++) {
            payload[i * 3 + 1] = r
            payload[i * 3 + 2] = g
            payload[i * 3 + 3] = b
        }

        await this.sender.send({ payload })
    }

    async disconnect(): Promise<void> {
        this.sender.close()
    }
}
