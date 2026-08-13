import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SfuService } from './sfu.service';
import { CreateSfuDto } from './dto/create-sfu.dto';
import { UpdateSfuDto } from './dto/update-sfu.dto';

@Controller('sfu')
export class SfuController {
  constructor(private readonly sfuService: SfuService) {}

  @Post()
  create(@Body() createSfuDto: CreateSfuDto) {
    return this.sfuService.create(createSfuDto);
  }

  @Get()
  findAll() {
    return this.sfuService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sfuService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSfuDto: UpdateSfuDto) {
    return this.sfuService.update(+id, updateSfuDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sfuService.remove(+id);
  }
}
