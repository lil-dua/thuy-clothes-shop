import type { Route } from "./+types/anh-mac-dinh";
import {
	LABELS,
	PALETTES,
	renderPlaceholderSvg,
	SHAPES,
	type PlaceholderKind,
} from "~/lib/placeholder-shapes";

/**
 * Ảnh mặc định cho sản phẩm chưa có ảnh, một tệp SVG cho mỗi loại quần áo.
 *
 * Phục vụ qua route thay vì nhúng data-URI vào HTML: một trang danh sách có
 * hàng chục thẻ sản phẩm, nhúng thẳng thì mỗi thẻ gánh thêm ~1KB. Còn ở đây
 * trình duyệt tải một lần rồi dùng lại cho mọi thẻ cùng loại.
 */
export function loader({ params }: Route.LoaderArgs) {
	const kind = (params.kind ?? "").replace(/\.svg$/, "") as PlaceholderKind;
	if (!(kind in SHAPES)) {
		throw new Response("Không có ảnh mặc định loại này", { status: 404 });
	}

	return new Response(renderPlaceholderSvg(kind, { ...PALETTES[kind], label: LABELS[kind] }), {
		headers: {
			"Content-Type": "image/svg+xml; charset=utf-8",
			// Ảnh chỉ đổi khi deploy bản mới, nên cache thoải mái
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}
