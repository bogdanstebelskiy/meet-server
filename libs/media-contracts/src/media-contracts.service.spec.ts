import { Test, TestingModule } from '@nestjs/testing';
import { MediaContractsService } from './media-contracts.service';

describe('MediaContractsService', () => {
  let service: MediaContractsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaContractsService],
    }).compile();

    service = module.get<MediaContractsService>(MediaContractsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
