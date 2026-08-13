import { Test, TestingModule } from '@nestjs/testing';
import { SfuController } from './sfu.controller';
import { SfuService } from './sfu.service';

describe('SfuController', () => {
  let controller: SfuController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SfuController],
      providers: [SfuService],
    }).compile();

    controller = module.get<SfuController>(SfuController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
