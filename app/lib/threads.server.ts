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
import { THREADS_PLACEHOLDERS, type SocialPost, type SocialSet } from "./threads";
import type { ProductDetail } from "./types";

export { THREADS_PLACEHOLDERS };
export type { SocialPost, SocialSet };

const API = "https://api.typefully.com/v2";

/** Số ảnh tối đa đính kèm một bài — đủ khoe sản phẩm mà không kéo dài request */
const MAX_MEDIA = 4;

/** Số lần hỏi lại trạng thái ảnh trước khi bỏ cuộc (mỗi lần cách nhau 1 giây) */
const MEDIA_POLL_ATTEMPTS = 12;

export type ThreadsResult =
	| { ok: true; draftId: string; caption: string; mediaCount: number; privateUrl: string | null }
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
		return {
			ok: false,
			error: `Typefully trả lỗi ${response.status}: ${body.slice(0, 300) || response.statusText}`,
		};
	}

	return { ok: true, data: (await response.json()) as T };
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
	file: { name: string; bytes: ArrayBuffer; contentType: string; altText: string },
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

	const put = await fetch(uploadUrl, {
		method: "PUT",
		body: file.bytes,
		headers: { "Content-Type": file.contentType },
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
	{ text, mediaIds, publishNow }: { text: string; mediaIds: string[]; publishNow: boolean },
) {
	return call<DraftResponse>(apiKey, `/social-sets/${socialSetId}/drafts`, {
		method: "POST",
		body: JSON.stringify({
			platforms: {
				threads: {
					posts: [
						{
							text,
							...(mediaIds.length > 0 && {
								media: mediaIds.map((mediaId) => ({ media_id: mediaId })),
							}),
						},
					],
				},
			},
			draft_title: text.split("\n")[0]?.slice(0, 80),
			// Không truyền publish_at thì bài nằm lại ở mục nháp trên Typefully,
			// chủ shop tự bấm đăng — hữu ích khi muốn xem lại trước khi lên sóng.
			...(publishNow && { publish_at: "now" }),
		}),
	});
}

// ---------------------------------------------------------------------------
// Đầu vào duy nhất cho phía route
// ---------------------------------------------------------------------------

export interface PostProductOptions {
	/** Caption đã được chủ shop sửa tay; bỏ trống thì sinh từ mẫu */
	caption?: string | null;
	/** false = chỉ tạo bản nháp trên Typefully, không đăng ngay */
	publishNow?: boolean;
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
			contentType: object.httpMetadata?.contentType ?? "image/jpeg",
			altText: image.alt ?? product.name,
		});

		if (upload.ok) mediaIds.push(upload.mediaId);
		else imageErrors.push(upload.error);
	}

	// Ảnh hỏng thì vẫn đăng phần chữ — thà có bài còn hơn mất bài vì một ảnh lỗi
	const draft = await createThreadsDraft(apiKey, socialSetId, {
		text: caption,
		mediaIds,
		publishNow: options.publishNow !== false,
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
	await logPost(db, product.id, {
		status: options.publishNow === false ? "publishing" : "published",
		caption,
		mediaCount: mediaIds.length,
		draftId,
		publishedUrl: draft.data.threads_published_url ?? draft.data.private_url,
		error: imageErrors.length > 0 ? dedupe(imageErrors) : null,
	});

	return {
		ok: true,
		draftId,
		caption,
		mediaCount: mediaIds.length,
		privateUrl: draft.data.private_url,
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
		status: "publishing" | "published" | "failed";
		caption: string;
		mediaCount: number;
		draftId?: string;
		publishedUrl?: string | null;
		error?: string | null;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO social_posts
			   (product_id, platform, draft_id, status, caption, media_count, published_url, error)
			 VALUES (?1, 'threads', ?2, ?3, ?4, ?5, ?6, ?7)`,
		)
		.bind(
			productId,
			entry.draftId ?? null,
			entry.status,
			entry.caption,
			entry.mediaCount,
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
			        published_url, error, created_at
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
			 WHERE status IN ('published', 'publishing') AND product_id IS NOT NULL`,
		)
		.all<{ product_id: number }>();
	return new Set((results ?? []).map((row) => row.product_id));
}
