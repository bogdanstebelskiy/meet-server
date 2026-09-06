import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SfuConfigService } from '../config/sfu-config.service';
import { SfuClientService } from './sfu-client.service';
import type { ReachableSfuNode } from './types';

@Injectable()
export class SfuRegistryService {
  constructor(
    private readonly sfuConfig: SfuConfigService,
    private readonly sfuClient: SfuClientService,
  ) {}

  // Picks once, at room creation - a room's sfu instance never changes after
  // (mediasoup Routers don't migrate, see docs/sfu-signaling-design.md).
  async pickLeastLoaded(): Promise<string> {
    const nodeUrls = this.sfuConfig.serviceUrls;
    const statsSettlements = await Promise.allSettled(
      nodeUrls.map((nodeUrl) => this.fetchNodeStats(nodeUrl)),
    );

    const reachableNodes: ReachableSfuNode[] = [];
    statsSettlements.forEach((settlement) => {
      if (settlement.status === 'fulfilled') {
        reachableNodes.push(settlement.value);
      }
    });

    if (reachableNodes.length === 0) {
      throw new HttpException(
        'No reachable sfu instance to assign this room to',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let leastLoaded = reachableNodes[0];
    for (const node of reachableNodes) {
      if (node.roomCount < leastLoaded.roomCount) {
        leastLoaded = node;
      }
    }

    return leastLoaded.nodeUrl;
  }

  private async fetchNodeStats(nodeUrl: string): Promise<ReachableSfuNode> {
    const { roomCount } = await this.sfuClient.getStats(nodeUrl);
    return { nodeUrl, roomCount };
  }
}
