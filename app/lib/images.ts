/** Dựng URL ảnh sản phẩm. Ảnh nằm trong R2, phục vụ qua route /anh/* */

export function imageUrl(r2Key: string | null | undefined): string | null {
	if (!r2Key) return null;
	return `/anh/${r2Key}`;
}

/** Ảnh nền thay thế khi sản phẩm chưa có ảnh nào */
export const IMAGE_PLACEHOLDER =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">
			<rect width="400" height="500" fill="#F7EBEF"/>
			<path d="M150 200h100v20l-20 10v90h-60v-90l-20-10z" fill="#E4C3CE"/>
			<text x="200" y="360" font-family="system-ui" font-size="18" fill="#C79BAB"
			      text-anchor="middle">Chưa có ảnh</text>
		</svg>`,
	);
