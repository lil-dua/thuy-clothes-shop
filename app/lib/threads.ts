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

export interface SocialPost {
	id: number;
	product_id: number;
	draft_id: string | null;
	status: "publishing" | "published" | "failed";
	caption: string;
	media_count: number;
	published_url: string | null;
	error: string | null;
	created_at: string;
}

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
