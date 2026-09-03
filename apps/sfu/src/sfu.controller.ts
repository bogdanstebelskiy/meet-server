import { Controller, Get } from '@nestjs/common';
import { SfuService } from './sfu.service';

@Controller()
export class SfuController {
  constructor(private readonly sfuService: SfuService) {}

  @Get()
  getHello(): string {
    return this.sfuService.getHello();
  }
}
