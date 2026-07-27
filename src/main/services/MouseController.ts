import { HidppDevice } from '../hidpp/HidppDevice'
import { openHidppDevice } from '../hidpp/discovery'
import { HardcodedCluster, RgbEffectsController } from '../hidpp/RgbEffectsController'

const G502_HERO_PRODUCT_ID = 0xc08b
const DEVICE_INDEX = 0xff
const FEATURE_IDX = 0x2

export class MouseController extends RgbEffectsController {
    protected readonly fnSetSwControl = 0x80
    protected readonly fnSetEffect = 0x30
    protected readonly clusters: HardcodedCluster[] = [
        { index: 0, staticEffectIdx: 1 },
        { index: 1, staticEffectIdx: 1 }
    ]

    private constructor(hidpp: HidppDevice) {
        super(hidpp, FEATURE_IDX, `mouse 0x${G502_HERO_PRODUCT_ID.toString(16)}`)
    }

    static async connect(): Promise<MouseController | null> {
        const opened = await openHidppDevice(G502_HERO_PRODUCT_ID, DEVICE_INDEX)
        if (!opened) return null
        return new MouseController(opened.hidpp)
    }

    protected swControlRequest(): number[] {
        return [0x01, 0x00]
    }
}
