import { Test, TestingModule } from '@nestjs/testing';
import { SfuService } from './sfu.service';

describe('SfuService', () => {
  let service: SfuService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SfuService],
    }).compile();

    service = module.get<SfuService>(SfuService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
