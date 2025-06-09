import { ApiClient } from '../api';
import { Job } from '../types/business';
import {} from 'date-fns';

class Producer {
  public constructor(private readonly apiClient: ApiClient) {
    // This class is a placeholder for the Producer client.
    // The actual implementation would go here, but it's not provided in the original code snippet.
  }

  public async createJob(jobData: ApiClient): Promise<Job> {
    const res = await this.apiClient.POST('/jobs', {
      body: {
        creator: 'MAP_COLONIES',
        data: {},
        jobMode: 'PRE_DEFINED',
        notifications: {},
        userMetadata: {},
        name: 'DEFAULT',
        expirationTime: 'sss',
        priority: 'HIGH',
        ttl: 'xd',
        stages: [{ data: {}, type: 'DEFAULT', userMetadata: {} }],
      },
    });
    return res;
  }
}
