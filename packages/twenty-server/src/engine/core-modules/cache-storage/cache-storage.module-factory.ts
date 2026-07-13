import { type CacheModuleOptions } from '@nestjs/cache-manager';

import { redisInsStore } from 'cache-manager-redis-yet';
import { createClient, type RedisClientType } from 'redis';

import { CacheStorageType } from 'src/engine/core-modules/cache-storage/types/cache-storage-type.enum';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

export const cacheStorageModuleFactory = async (
  twentyConfigService: TwentyConfigService,
): Promise<CacheModuleOptions> => {
  const cacheStorageType = CacheStorageType.Redis;
  const cacheStorageTtl = twentyConfigService.get('CACHE_STORAGE_TTL');
  const cacheModuleOptions: CacheModuleOptions = {
    isGlobal: true,
    ttl: cacheStorageTtl * 1000,
  };

  switch (cacheStorageType) {
    /* case CacheStorageType.Memory: {
      return cacheModuleOptions;
    }*/
    case CacheStorageType.Redis: {
      const redisUrl = twentyConfigService.get('REDIS_URL');

      if (!redisUrl) {
        throw new Error(
          `${cacheStorageType} cache storage requires REDIS_URL to be defined, check your .env file`,
        );
      }

      const redisClient = createClient({
        url: redisUrl,
        pingInterval: 30_000,
        socket: {
          keepAlive: 30_000,
          reconnectStrategy: (retries: number) =>
            Math.min(retries * 200, 5_000),
        },
      });

      redisClient.on('error', (err) =>
        console.error('Cache Redis client error:', err),
      );

      await redisClient.connect();

      return {
        ...cacheModuleOptions,
        store: redisInsStore(redisClient as RedisClientType, {
          ttl: cacheStorageTtl * 1000,
        }),
      };
    }
    default:
      throw new Error(
        `Invalid cache-storage (${cacheStorageType}), check your .env file`,
      );
  }
};
