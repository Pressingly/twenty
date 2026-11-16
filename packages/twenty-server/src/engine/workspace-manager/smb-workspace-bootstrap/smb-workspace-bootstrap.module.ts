import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoreEntityCacheModule } from 'src/engine/core-entity-cache/core-entity-cache.module';
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { PreInstalledAppsModule } from 'src/engine/core-modules/application/pre-installed-apps/pre-installed-apps.module';
import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { SdkClientModule } from 'src/engine/core-modules/sdk-client/sdk-client.module';
import { UpgradeStatusModule } from 'src/engine/core-modules/upgrade/upgrade-status.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleModule } from 'src/engine/metadata-modules/role/role.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { SmbWorkspaceBootstrapService } from 'src/engine/workspace-manager/smb-workspace-bootstrap/services/smb-workspace-bootstrap.service';
import { TwentyStandardApplicationModule } from 'src/engine/workspace-manager/twenty-standard-application/twenty-standard-application.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceEntity, RoleEntity]),
    ApplicationModule,
    CoreEntityCacheModule,
    FeatureFlagModule,
    PreInstalledAppsModule,
    RoleModule,
    SdkClientModule,
    TwentyStandardApplicationModule,
    UpgradeStatusModule,
    WorkspaceCacheModule,
    WorkspaceCacheStorageModule,
    WorkspaceDataSourceModule,
  ],
  providers: [
    SmbWorkspaceBootstrapService,
    provideWorkspaceScopedRepository(RoleEntity),
  ],
  exports: [SmbWorkspaceBootstrapService],
})
export class SmbWorkspaceBootstrapModule {}
