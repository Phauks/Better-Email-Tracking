import {
	CAMPAIGN_API,
	type CampaignDetail,
	type CampaignLeaseRequest,
	type CampaignStatus,
	type CreateCampaignRequest,
	type ListCampaignsResponse,
	type RecipientResultRequest,
	type RecipientResultResponse,
	type UpdateCampaignRequest,
} from "@bet/shared";
import { ApiClient, ApiError } from "./client";

export type ResultOutcome =
	| RecipientResultResponse
	| { ok: false; conflict: true; error: string };

/** Worker client for mail merge campaigns (background worker and extension pages). */
export class CampaignClient extends ApiClient {
	listCampaigns(
		opts: { status?: CampaignStatus; limit?: number } = {},
	): Promise<ListCampaignsResponse> {
		const sp = new URLSearchParams();
		if (opts.status) sp.set("status", opts.status);
		if (opts.limit) sp.set("limit", String(opts.limit));
		const q = sp.toString();
		return this.request("GET", `${CAMPAIGN_API.campaigns}${q ? `?${q}` : ""}`);
	}
	getCampaign(id: string): Promise<CampaignDetail> {
		return this.request("GET", CAMPAIGN_API.campaign(id));
	}
	createCampaign(req: CreateCampaignRequest): Promise<CampaignDetail> {
		return this.request("POST", CAMPAIGN_API.campaigns, req);
	}
	updateCampaign(
		id: string,
		req: UpdateCampaignRequest,
	): Promise<CampaignDetail> {
		return this.request("PATCH", CAMPAIGN_API.campaign(id), req);
	}
	deleteCampaign(id: string): Promise<void> {
		return this.request("DELETE", CAMPAIGN_API.campaign(id));
	}
	/** False when another sender holds the lease or the campaign is not sending. */
	async leaseCampaign(id: string, req: CampaignLeaseRequest): Promise<boolean> {
		try {
			await this.request("POST", CAMPAIGN_API.lease(id), req);
			return true;
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) return false;
			throw err;
		}
	}
	/** A 409 (recipient or campaign changed state meanwhile) is returned, not thrown. */
	async recipientResult(
		id: string,
		email: string,
		req: RecipientResultRequest,
	): Promise<ResultOutcome> {
		try {
			return await this.request(
				"POST",
				CAMPAIGN_API.recipientResult(id, email),
				req,
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 409)
				return { ok: false, conflict: true, error: err.message };
			throw err;
		}
	}
}

export function campaignClient(s: {
	workerUrl: string;
	apiToken: string;
}): CampaignClient {
	return new CampaignClient(s.workerUrl, s.apiToken);
}
