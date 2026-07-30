import { HidppDevice } from './HidppDevice'
import { LightingService } from '../services/LightingService'

export interface HardcodedCluster {
    index: number
    staticEffectIdx: number
}

export abstract class RgbEffectsController implements LightingService {
    protected constructor(
        protected readonly hidpp: HidppDevice,
        protected readonly featIdx: number,
        protected readonly label: string
    ) {}

    protected abstract readonly fnSetSwControl: number
    protected abstract readonly fnSetEffect: number
    protected abstract readonly clusters: HardcodedCluster[]

    protected abstract swControlRequest(): number[]

    async setSolidColor(r: number, g: number, b: number): Promise<void> {
        await this.hidpp.sendAndReceive(this.featIdx, this.fnSetSwControl, this.swControlRequest())

        for (const cluster of this.clusters) {
            await this.applyStaticEffect(cluster, r, g, b)
        }
    }

    disconnect(): Promise<void> {
        return this.hidpp.close()
    }

    private async applyStaticEffect(cluster: HardcodedCluster, r: number, g: number, b: number): Promise<void> {
        const setData = new Array(16).fill(0)
        setData[0] = cluster.index
        setData[1] = cluster.staticEffectIdx
        setData[2] = r
        setData[3] = g
        setData[4] = b
        setData[5] = 0x02
        setData[12] = 0x01

        const result = await this.hidpp.sendAndReceive(this.featIdx, this.fnSetEffect, setData)
        if (!result) {
            console.error(`[${this.label}] SetEffectByIndex failed for cluster ${cluster.index} / no ack.`)
            return
        }

        console.log(`[${this.label}] Cluster ${cluster.index} set to rgb(${r}, ${g}, ${b}).`)
    }
}
