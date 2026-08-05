import { Module } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { LeavesController } from './leaves.controller';
import { LeavesResolver } from './leaves.resolver';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  providers: [LeavesService, LeavesResolver],
  controllers: [LeavesController],
  exports: [LeavesService],
})
export class LeavesModule {}
