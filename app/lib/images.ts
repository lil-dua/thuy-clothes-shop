/** Dựng URL ảnh sản phẩm. Ảnh nằm trong R2, phục vụ qua route /anh/* */

import { placeholderKind } from "./placeholder-shapes";
import type { TargetGroup } from "./types";

export function imageUrl(r2Key: string | null | undefined): string | null {
	if (!r2Key) return null;
	return `/anh/${r2Key}`;
}

/**
 * Ảnh mặc định khi sản phẩm chưa có ảnh — chọn hình theo loại quần áo, để lưới
 * sản phẩm không phải một dãy ô xám giống hệt nhau.
 *
 * Không biết danh mục (giỏ hàng, chi tiết đơn cũ) thì rơi về hình chung.
 */
export function placeholderFor(
	categorySlug?: string | null,
	targetGroup?: TargetGroup | null,
): string {
	return `/anh-mac-dinh/${placeholderKind(categorySlug, targetGroup)}.svg`;
}

/** Ảnh mặc định chung, dùng ở chỗ không biết sản phẩm thuộc loại nào */
export const IMAGE_PLACEHOLDER = "/anh-mac-dinh/generic.svg";
