import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { ShiftsResolver } from './shifts.resolver';

@Module({
  providers: [ShiftsService, ShiftsResolver],
  controllers: [ShiftsController],
  exports: [ShiftsService],
})
export class ShiftsModule {}
