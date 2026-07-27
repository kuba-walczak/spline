import { HidppDevice } from '../hidpp/HidppDevice'
import { openHidppDevice } from '../hidpp/discovery'
import { HardcodedCluster, RgbEffectsController } from '../hidpp/RgbEffectsController'

const G915_X_PRODUCT_ID = 0xc359
const DEVICE_INDEX = 0xff
const FEATURE_IDX = 0x6

export class KeyboardController extends RgbEffectsController {
    protected readonly fnSetSwControl = 0x50
    protected readonly fnSetEffect = 0x10
    protected readonly clusters: HardcodedCluster[] = [
        { index: 0, staticEffectIdx: 1 },
        { index: 1, staticEffectIdx: 1 }
    ]

    private constructor(hidpp: HidppDevice) {
        super(hidpp, FEATURE_IDX, `keyboard 0x${G915_X_PRODUCT_ID.toString(16)}`)
    }

    static async connect(): Promise<KeyboardController | null> {
        const opened = await openHidppDevice(G915_X_PRODUCT_ID, DEVICE_INDEX)
        if (!opened) return null
        return new KeyboardController(opened.hidpp)
    }

    protected swControlRequest(): number[] {
        return [0x01, 0x03, 0x05]
    }
}
