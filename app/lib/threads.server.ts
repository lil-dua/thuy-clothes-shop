/**
 * Đăng sản phẩm lên Threads qua Typefully — Giai đoạn 3 của kế hoạch.
 *
 * Vì sao đi qua Typefully mà không gọi thẳng API Threads của Meta: API chính
 * chủ đòi đăng ký Meta Developer app và xác minh doanh nghiệp, chờ vài tuần.
 * Typefully chỉ cần một API key lấy trong phần Settings của họ.
 *
 * Tài liệu: https://typefully.com/docs/api (API v2)
 */

import { formatVnd } from "./format";
import type { ShopSettings } from "./settings.server";
import {
	THREADS_PLACEHOLDERS,
	type SocialPost,
	type SocialPostStatus,
	type SocialSet,
} from "./threads";
import type { ProductDetail } from "./types";

export { THREADS_PLACEHOLDERS };
export type { SocialPost, SocialPostStatus, SocialSet };

const API = "https://api.typefully.com/v2";

/** Số ảnh tối đa đính kèm một bài — đủ khoe sản phẩm mà không kéo dài request */
const MAX_MEDIA = 4;

/** Số lần hỏi lại trạng thái ảnh trước khi bỏ cuộc (mỗi lần cách nhau 1 giây) */
const MEDIA_POLL_ATTEMPTS = 12;

export type ThreadsResult =
	| {
			ok: true;
			draftId: string;
			caption: string;
			mediaCount: number;
			privateUrl: string | null;
			status: SocialPostStatus;
			scheduledAt: string | null;
	  }
	| { ok: false; error: string };

// ---------------------------------------------------------------------------
// Caption
// ---------------------------------------------------------------------------

/**
 * Dựng caption từ mẫu trong Cài đặt.
 * Dòng nào chỉ còn mỗi nhãn sau khi thay (ví dụ "Màu:" mà sản phẩm không có
 * màu) sẽ bị bỏ đi, để bài đăng không lòi ra những dòng trống vô nghĩa.
 */
export function buildCaption(
	product: ProductDetail,
	settings: ShopSettings,
	shopUrl: string,
): string {
	const inStock = product.variants.filter(
		(variant) => variant.is_active && variant.quantity > 0,
	);
	const sizes = [...new Set(inStock.map((variant) => variant.size))];
	const colors = [
		...new Set(inStock.map((variant) => variant.color).filter((color): color is string => Boolean(color))),
	];

	const values: Record<string, string> = {
		"{ten}": product.name,
		"{gia}": formatVnd(product.sale_price),
		"{gia_goc}": product.compare_price ? formatVnd(product.compare_price) : "",
		"{size}": sizes.join(", "),
		"{mau}": colors.join(", "),
		"{mota}": product.description ?? "",
		"{danh_muc}": product.category_name ?? "",
		"{link}": `${shopUrl.replace(/\/$/, "")}/san-pham/${product.slug}`,
	};

	const template = settings.threads_caption_template || "{ten}\n{gia}\n{link}";
	const filled = Object.entries(values).reduce(
		(text, [token, value]) => text.replaceAll(token, value),
		template,
	);

	return filled
		.split("\n")
		// Bỏ dòng rỗng hẳn và dòng chỉ còn nhãn + dấu hai chấm, ví dụ "🎨 Màu:"
		.filter((line, index, lines) => {
			const trimmed = line.trim();
			if (/^[^\w\s]*\s*[\p{L}\s]+:\s*$/u.test(trimmed)) return false;
			// Giữ lại một dòng trống, bỏ những dòng trống liên tiếp
			if (trimmed === "") return index > 0 && lines[index - 1].trim() !== "";
			return true;
		})
		.join("\n")
		.trim();
}

// ---------------------------------------------------------------------------
// Gọi API
// ---------------------------------------------------------------------------

async function call<T>(
	apiKey: string,
	path: string,
	init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
	let response: Response;
	try {
		response = await fetch(`${API}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...init.headers,
			},
		});
	} catch (error) {
		return { ok: false, error: `Không kết nối được Typefully: ${String(error)}` };
	}

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		if (response.status === 401 || response.status === 403) {
			return { ok: false, error: "API key Typefully không hợp lệ hoặc đã bị thu hồi" };
		}
		return { ok: false, error: describeApiError(response, body) };
	}

	return { ok: true, data: (await response.json()) as T };
}

/**
 * Biến lỗi của Typefully thành câu đọc được.
 *
 * Lỗi 422 trả về dạng:
 *   {"error": {"code": "VALIDATION_ERROR", "message": "...",
 *              "details": [{"field": "platforms.threads.enabled", "message": "Field required"}]}}
 * Đổ nguyên khối JSON đó lên màn hình thì chủ shop không hiểu gì, mà lập trình
 * viên cũng phải soi từng ký tự — nên rút gọn còn field + message.
 */
function describeApiError(response: Response, body: string): string {
	try {
		const parsed = JSON.parse(body) as {
			error?: {
				message?: string;
				details?: { field?: string; message?: string }[];
			};
		};
		const details = parsed.error?.details
			?.map((detail) => [detail.field, detail.message].filter(Boolean).join(": "))
			.filter(Boolean);

		if (details?.length) {
			return `Typefully từ chối bài đăng (${response.status}): ${details.join(" | ")}`;
		}
		if (parsed.error?.message) {
			return `Typefully trả lỗi ${response.status}: ${parsed.error.message}`;
		}
	} catch {
		// Không phải JSON thì rơi xuống dùng nguyên văn bên dưới
	}
	return `Typefully trả lỗi ${response.status}: ${body.slice(0, 300) || response.statusText}`;
}

/** Danh sách tài khoản mạng xã hội gắn với API key — để chủ shop chọn trong Cài đặt */
export async function listSocialSets(
	apiKey: string,
): Promise<{ ok: true; sets: SocialSet[] } | { ok: false; error: string }> {
	const result = await call<{ results: SocialSet[] }>(apiKey, "/social-sets?limit=50");
	if (!result.ok) return result;
	return { ok: true, sets: result.data.results ?? [] };
}

/**
 * Tải một ảnh lên Typefully theo đúng ba bước của API v2:
 *   1. xin chỗ chứa   → nhận media_id + upload_url
 *   2. PUT thẳng bytes lên S3 (KHÔNG kèm header Authorization — chữ ký đã nằm
 *      trong URL, thêm header sẽ bị S3 từ chối)
 *   3. hỏi lại tới khi status = "ready" thì mới dùng được trong bài đăng
 */
async function uploadMedia(
	apiKey: string,
	socialSetId: string,
	file: { name: string; bytes: ArrayBuffer; altText: string },
): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
	const created = await call<{ media_id: string; upload_url: string }>(
		apiKey,
		`/social-sets/${socialSetId}/media/upload`,
		{
			method: "POST",
			body: JSON.stringify({ file_name: file.name, alt_text: file.altText }),
		},
	);
	if (!created.ok) return created;

	const { media_id: mediaId, upload_url: uploadUrl } = created.data;

	// KHÔNG gửi kèm header nào. upload_url ký theo SigV2 (AWSAccessKeyId +
	// Signature + Expires) và chỉ ký sẵn ba header x-amz-meta-*. Thêm bất kỳ
	// header nào khác — kể cả Content-Type — đều làm chữ ký lệch và S3 trả 403.
	// Đây là lý do mọi bài đăng kèm ảnh trước đây đều mất ảnh.
	const put = await fetch(uploadUrl, {
		method: "PUT",
		body: file.bytes,
	}).catch((error) => error as Error);

	if (put instanceof Error) {
		return { ok: false, error: `Không tải được ảnh lên: ${put.message}` };
	}
	if (!put.ok) {
		return { ok: false, error: `Không tải được ảnh lên (mã ${put.status})` };
	}

	for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS; attempt++) {
		const status = await call<{ status: string }>(
			apiKey,
			`/social-sets/${socialSetId}/media/${mediaId}`,
		);
		if (!status.ok) return status;
		if (status.data.status === "ready") return { ok: true, mediaId };
		if (status.data.status === "failed") {
			return { ok: false, error: "Typefully xử lý ảnh thất bại" };
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	return { ok: false, error: "Ảnh xử lý quá lâu, thử lại sau" };
}

interface DraftResponse {
	id: number;
	private_url: string | null;
	threads_published_url: string | null;
}

async function createThreadsDraft(
	apiKey: string,
	socialSetId: string,
	{ text, mediaIds, publishAt }: { text: string; mediaIds: string[]; publishAt: string | null },
) {
	return call<DraftResponse>(apiKey, `/social-sets/${socialSetId}/drafts`, {
		method: "POST",
		body: JSON.stringify({
			platforms: {
				threads: {
					// Bắt buộc, dù trang docs chi tiết không nhắc tới. Thiếu nó thì
					// API trả 422 "platforms.threads.enabled — Field required".
					enabled: true,
					// Bài Threads dùng schema LinkPreviewPost: { text, media_ids[],
					// hide_link_preview }. Ảnh là MẢNG CHUỖI id — không phải mảng
					// object { media_id }, dạng đó API trả 422 "Extra inputs are not
					// permitted". Lấy từ https://api.typefully.com/v2/openapi.json,
					// trang docs không mô tả đúng.
					posts: [{ text, ...(mediaIds.length > 0 && { media_ids: mediaIds }) }],
				},
			},
			draft_title: text.split("\n")[0]?.slice(0, 80),
			// "now" = đăng ngay; chuỗi ISO có múi giờ = hẹn giờ, Typefully tự giữ
			// bài tới đúng mốc đó. Không truyền gì thì bài nằm lại ở mục nháp để
			// chủ shop tự xem lại rồi bấm đăng.
			...(publishAt && { publish_at: publishAt }),
		}),
	});
}

// ---------------------------------------------------------------------------
// Đầu vào duy nhất cho phía route
// ---------------------------------------------------------------------------

export interface PostProductOptions {
	/** Caption đã được chủ shop sửa tay; bỏ trống thì sinh từ mẫu */
	caption?: string | null;
	/**
	 * Khi nào đăng:
	 *   "now"            — đăng ngay
	 *   chuỗi ISO có múi giờ — hẹn giờ, Typefully giữ bài tới đúng mốc đó
	 *   null             — chỉ lưu nháp trên Typefully
	 */
	publishAt: string | null;
	/** Mốc hẹn giờ ở dạng UTC để lưu vào D1 (chỉ dùng khi hẹn giờ) */
	scheduledAtUtc?: string | null;
	/** Địa chỉ gốc của shop, dùng dựng link sản phẩm trong caption */
	shopUrl: string;
}

/**
 * Đăng một sản phẩm lên Threads và ghi lại kết quả vào bảng social_posts.
 * Mọi lỗi đều được ghi kèm thông báo để chủ shop biết vì sao hỏng và thử lại.
 */
export async function postProductToThreads(
	db: D1Database,
	bucket: R2Bucket,
	apiKey: string,
	settings: ShopSettings,
	product: ProductDetail,
	options: PostProductOptions,
): Promise<ThreadsResult> {
	const socialSetId = settings.typefully_social_set_id;
	if (!socialSetId) {
		return { ok: false, error: "Chưa chọn tài khoản Typefully trong trang Cài đặt" };
	}

	const caption = options.caption?.trim() || buildCaption(product, settings, options.shopUrl);
	if (!caption) return { ok: false, error: "Caption trống" };

	// Ảnh lấy thẳng từ R2 qua binding, không phải tải về qua HTTP
	const mediaIds: string[] = [];
	const imageErrors: string[] = [];

	for (const image of product.images.slice(0, MAX_MEDIA)) {
		const object = await bucket.get(image.r2_key);
		if (!object) {
			imageErrors.push(`Không tìm thấy ảnh ${image.r2_key}`);
			continue;
		}

		const upload = await uploadMedia(apiKey, socialSetId, {
			name: image.r2_key.split("/").pop() ?? "anh.jpg",
			bytes: await object.arrayBuffer(),
			altText: image.alt ?? product.name,
		});

		if (upload.ok) mediaIds.push(upload.mediaId);
		else imageErrors.push(upload.error);
	}

	// Ảnh hỏng thì vẫn đăng phần chữ — thà có bài còn hơn mất bài vì một ảnh lỗi
	const draft = await createThreadsDraft(apiKey, socialSetId, {
		text: caption,
		mediaIds,
		publishAt: options.publishAt,
	});

	if (!draft.ok) {
		await logPost(db, product.id, {
			status: "failed",
			caption,
			mediaCount: mediaIds.length,
			// Ảnh lỗi và bài lỗi thường cùng một nguyên nhân (khoá sai, mất mạng),
			// nên gộp trùng lại thay vì lặp lại cùng câu ba bốn lần.
			error: dedupe([draft.error, ...imageErrors]),
		});
		return { ok: false, error: draft.error };
	}

	const draftId = String(draft.data.id);
	const status: SocialPostStatus =
		options.publishAt === null
			? "draft"
			: options.publishAt === "now"
				? "published"
				: "scheduled";
	const scheduledAt = status === "scheduled" ? (options.scheduledAtUtc ?? null) : null;

	await logPost(db, product.id, {
		status,
		caption,
		mediaCount: mediaIds.length,
		draftId,
		scheduledAt,
		publishedUrl: draft.data.threads_published_url ?? draft.data.private_url,
		error: imageErrors.length > 0 ? dedupe(imageErrors) : null,
	});

	return {
		ok: true,
		draftId,
		caption,
		mediaCount: mediaIds.length,
		privateUrl: draft.data.private_url,
		status,
		scheduledAt,
	};
}

/** Gộp các thông báo lỗi trùng nhau thành một dòng đọc được */
function dedupe(messages: string[]): string {
	return [...new Set(messages.filter(Boolean))].join(" | ");
}

async function logPost(
	db: D1Database,
	productId: number,
	entry: {
		status: SocialPostStatus;
		caption: string;
		mediaCount: number;
		draftId?: string;
		scheduledAt?: string | null;
		publishedUrl?: string | null;
		error?: string | null;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO social_posts
			   (product_id, platform, draft_id, status, caption, media_count,
			    scheduled_at, published_url, error)
			 VALUES (?1, 'threads', ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
		)
		.bind(
			productId,
			entry.draftId ?? null,
			entry.status,
			entry.caption,
			entry.mediaCount,
			entry.scheduledAt ?? null,
			entry.publishedUrl ?? null,
			entry.error ?? null,
		)
		.run();
}

export async function getProductPosts(
	db: D1Database,
	productId: number,
	limit = 5,
): Promise<SocialPost[]> {
	const { results } = await db
		.prepare(
			`SELECT id, product_id, draft_id, status, caption, media_count,
			        scheduled_at, published_url, error, created_at
			 FROM social_posts WHERE product_id = ?1
			 ORDER BY created_at DESC, id DESC LIMIT ?2`,
		)
		.bind(productId, limit)
		.all<SocialPost>();
	return results ?? [];
}

/** Đếm sản phẩm đã từng đăng thành công — hiện ở bảng sản phẩm trong admin */
export async function getPostedProductIds(db: D1Database): Promise<Set<number>> {
	const { results } = await db
		.prepare(
			`SELECT DISTINCT product_id FROM social_posts
			 WHERE status IN ('published', 'publishing', 'scheduled')
			   AND product_id IS NOT NULL`,
		)
		.all<{ product_id: number }>();
	return new Set((results ?? []).map((row) => row.product_id));
}

// ---------------------------------------------------------------------------
// Huỷ bài đã hẹn giờ
// ---------------------------------------------------------------------------

/**
 * Huỷ một bài chưa đăng: xoá bản nháp bên Typefully rồi đánh dấu 'cancelled'.
 *
 * Nếu Typefully trả 404 thì bản nháp đã biến mất sẵn (chủ shop tự xoá bên đó),
 * vẫn coi là huỷ thành công — cốt để hai bên khớp nhau, không phải để bắt lỗi.
 */
export async function cancelScheduledPost(
	db: D1Database,
	apiKey: string,
	settings: ShopSettings,
	postId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const post = await db
		.prepare(
			`SELECT id, draft_id, status FROM social_posts WHERE id = ?1`,
		)
		.bind(postId)
		.first<{ id: number; draft_id: string | null; status: SocialPostStatus }>();

	if (!post) return { ok: false, error: "Không tìm thấy bài đăng" };
	if (post.status !== "scheduled" && post.status !== "draft") {
		return { ok: false, error: "Chỉ huỷ được bài chưa đăng" };
	}

	if (post.draft_id && settings.typefully_social_set_id) {
		const deleted = await call<unknown>(
			apiKey,
			`/social-sets/${settings.typefully_social_set_id}/drafts/${post.draft_id}`,
			{ method: "DELETE" },
		);
		if (!deleted.ok && !deleted.error.includes("404")) return deleted;
	}

	await db
		.prepare(
			`UPDATE social_posts SET status = 'cancelled', updated_at = datetime('now')
			 WHERE id = ?1`,
		)
		.bind(postId)
		.run();

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Đồng bộ trạng thái bài đã hẹn giờ
// ---------------------------------------------------------------------------

/** Trạng thái Typefully -> trạng thái trong DB của mình */
const REMOTE_STATUS: Record<string, SocialPostStatus> = {
	draft: "draft",
	planned: "draft",
	scheduled: "scheduled",
	publishing: "publishing",
	published: "published",
	error: "failed",
};

/**
 * Hỏi lại Typefully xem các bài đã tới giờ đăng ra sao, rồi cập nhật lại DB.
 *
 * Việc đăng do Typefully lo — hàm này chỉ để trang quản trị hiển thị đúng,
 * nếu không bài đã lên sóng vẫn nằm đó với nhãn "Đã hẹn giờ" mãi mãi.
 * Gọi từ cron (xem workers/app.ts) và mỗi lần mở trang sửa sản phẩm.
 */
export async function syncScheduledPosts(
	db: D1Database,
	apiKey: string,
	settings: ShopSettings,
	{ limit = 20 } = {},
): Promise<number> {
	const socialSetId = settings.typefully_social_set_id;
	if (!socialSetId) return 0;

	const { results } = await db
		.prepare(
			`SELECT id, draft_id FROM social_posts
			 WHERE status IN ('scheduled', 'publishing')
			   AND draft_id IS NOT NULL
			   AND (scheduled_at IS NULL OR scheduled_at <= datetime('now'))
			 ORDER BY scheduled_at LIMIT ?1`,
		)
		.bind(limit)
		.all<{ id: number; draft_id: string }>();

	const due = results ?? [];
	let updated = 0;

	for (const post of due) {
		const remote = await call<{
			status: string;
			threads_published_url: string | null;
			private_url: string | null;
		}>(apiKey, `/social-sets/${socialSetId}/drafts/${post.draft_id}`);

		if (!remote.ok) {
			// Bản nháp bị xoá bên Typefully thì bên mình cũng không chờ nữa
			if (remote.error.includes("404")) {
				await db
					.prepare(
						`UPDATE social_posts SET status = 'cancelled',
						   error = 'Bản nháp đã bị xoá trên Typefully',
						   updated_at = datetime('now')
						 WHERE id = ?1`,
					)
					.bind(post.id)
					.run();
				updated++;
			}
			continue;
		}

		const status = REMOTE_STATUS[remote.data.status] ?? "scheduled";
		await db
			.prepare(
				`UPDATE social_posts SET status = ?2, published_url = COALESCE(?3, published_url),
				   updated_at = datetime('now')
				 WHERE id = ?1`,
			)
			.bind(
				post.id,
				status,
				remote.data.threads_published_url ?? remote.data.private_url ?? null,
			)
			.run();
		updated++;
	}

	return updated;
}

/** Bài đang chờ tới giờ đăng — hiện ở trang Tổng quan */
export async function getUpcomingPosts(
	db: D1Database,
	limit = 5,
): Promise<(SocialPost & { product_name: string | null; product_slug: string | null })[]> {
	const { results } = await db
		.prepare(
			`SELECT s.id, s.product_id, s.draft_id, s.status, s.caption, s.media_count,
			        s.scheduled_at, s.published_url, s.error, s.created_at,
			        p.name AS product_name, p.slug AS product_slug
			 FROM social_posts s
			 LEFT JOIN products p ON p.id = s.product_id
			 WHERE s.status = 'scheduled'
			 ORDER BY s.scheduled_at LIMIT ?1`,
		)
		.bind(limit)
		.all<SocialPost & { product_name: string | null; product_slug: string | null }>();
	return results ?? [];
}
