/**
 * Phần dùng chung của tính năng đăng Threads — an toàn cho cả client.
 *
 * Tách khỏi threads.server.ts vì trang Cài đặt phải hiển thị danh sách từ khoá
 * thay thế; import một giá trị runtime từ tệp *.server sẽ kéo cả mã gọi API
 * vào bundle trình duyệt và build sẽ báo lỗi.
 */

export interface SocialSet {
	id: number;
	username: string;
	name: string;
}

export type SocialPostStatus =
	| "draft"       // nằm ở mục nháp trên Typefully, chưa hẹn giờ
	| "scheduled"   // đã hẹn giờ, Typefully sẽ tự đăng
	| "publishing"  // Typefully đang đăng
	| "published"   // đã lên sóng
	| "failed"      // gọi API hỏng hoặc Typefully báo lỗi
	| "cancelled";  // chủ shop huỷ trước giờ đăng

export interface SocialPost {
	id: number;
	product_id: number;
	draft_id: string | null;
	status: SocialPostStatus;
	caption: string;
	media_count: number;
	/** Mốc Typefully sẽ đăng, lưu UTC — null nếu không hẹn giờ */
	scheduled_at: string | null;
	published_url: string | null;
	error: string | null;
	created_at: string;
}

export const POST_STATUS_LABEL: Record<SocialPostStatus, string> = {
	draft: "Bản nháp",
	scheduled: "Đã hẹn giờ",
	publishing: "Đang đăng",
	published: "Đã đăng",
	failed: "Lỗi",
	cancelled: "Đã huỷ",
};

export const POST_STATUS_STYLE: Record<SocialPostStatus, string> = {
	draft: "bg-ink-100 text-ink-600",
	scheduled: "bg-blue-100 text-blue-700",
	publishing: "bg-amber-100 text-amber-700",
	published: "bg-green-100 text-green-700",
	failed: "bg-red-100 text-red-700",
	cancelled: "bg-ink-100 text-ink-500",
};

/** Các từ khoá thay được trong mẫu caption, hiện ở trang Cài đặt */
export const THREADS_PLACEHOLDERS = [
	{ token: "{ten}", label: "Tên sản phẩm" },
	{ token: "{gia}", label: "Giá bán" },
	{ token: "{gia_goc}", label: "Giá gốc (nếu đang giảm)" },
	{ token: "{size}", label: "Các size còn hàng" },
	{ token: "{mau}", label: "Các màu còn hàng" },
	{ token: "{mota}", label: "Mô tả ngắn" },
	{ token: "{danh_muc}", label: "Danh mục" },
	{ token: "{link}", label: "Đường dẫn tới trang sản phẩm" },
] as const;
