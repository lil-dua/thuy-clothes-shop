/**
 * Hình vẽ quần áo dùng cho ảnh mặc định khi sản phẩm chưa có ảnh thật.
 *
 * Đây là NGUỒN DUY NHẤT: route /anh-mac-dinh/* dựng ảnh từ đây, và
 * scripts/seed-images.mjs cũng nạp chính tệp này để sinh ảnh minh hoạ cho dữ
 * liệu mẫu — sửa một chỗ là cả hai nơi đổi theo.
 *
 * Vẽ trong khung 800×1000 (tỉ lệ 4:5, khớp khung ảnh sản phẩm trên web).
 */

export type PlaceholderKind =
	| "dress"
	| "maxi"
	| "babydoll"
	| "tee"
	| "shirt"
	| "pants"
	| "skirt"
	| "set"
	| "kidsdress"
	| "shorts"
	| "hat"
	| "generic";

export const SHAPES: Record<PlaceholderKind, string> = {
	dress: `<path d="M300 300h200l40 90-60 30 25 320H295l25-320-60-30z"/>
	        <path d="M300 300q100 60 200 0"/>`,
	maxi: `<path d="M340 290h120l50 110-55 20 40 340H305l40-340-55-20z"/>`,
	babydoll: `<path d="M310 300h180l45 95-55 25 15 260H305l15-260-55-25z"/>`,
	tee: `<path d="M295 300h210l70 70-55 55-15-25v290H295V400l-15 25-55-55z"/>`,
	shirt: `<path d="M300 295h200l75 75-60 55-15-20v285H300V405l-15 20-60-55z"/>
	        <path d="M400 300v390"/>`,
	pants: `<path d="M320 320h160v70l-20 320h-55l-25-250-25 250h-55l-20-320z"/>`,
	skirt: `<path d="M330 320h140l60 350H270z"/>`,
	set: `<path d="M305 285h190l60 62-50 46-12-18v130H307V375l-12 18-50-46z"/>
	      <path d="M320 530h160v60l-18 170h-50l-12-130-12 130h-50l-18-170z"/>`,
	kidsdress: `<path d="M330 320h140l30 70-45 22 40 250H305l40-250-45-22z"/>
	            <circle cx="400" cy="300" r="26"/>`,
	shorts: `<path d="M325 350h150v60l-15 160h-50l-10-120-10 120h-50l-15-160z"/>`,
	hat: `<ellipse cx="400" cy="520" rx="185" ry="60"/>
	      <path d="M280 520q0-150 120-150t120 150"/>`,
	generic: `<path d="M310 300h180l50 95-55 28 20 287H295l20-287-55-28z"/>`,
};

export interface Palette {
	from: string;
	to: string;
	accent: string;
}

/** Đồ nữ ngả hồng, đồ trẻ em ngả vàng/xanh cho tươi hơn */
export const PALETTES: Record<PlaceholderKind, Palette> = {
	dress: { from: "#FDE8EF", to: "#F7C6D9", accent: "#E79BB6" },
	maxi: { from: "#F7F0E6", to: "#E8D8C3", accent: "#CBB496" },
	babydoll: { from: "#FFFFFF", to: "#F4F1F3", accent: "#DCD3D8" },
	tee: { from: "#E8F5F1", to: "#BFE3DA", accent: "#8FC9BC" },
	shirt: { from: "#FAF3E9", to: "#F3E9DC", accent: "#D9C6AE" },
	pants: { from: "#EAF1F8", to: "#A8BFD6", accent: "#7D9CBC" },
	skirt: { from: "#F0EFF1", to: "#CFCCD2", accent: "#8E8992" },
	set: { from: "#F7F1E8", to: "#E8D8C3", accent: "#C3AB8C" },
	kidsdress: { from: "#FDE8EF", to: "#F7C6D9", accent: "#E79BB6" },
	shorts: { from: "#FCF4DC", to: "#F6E1A6", accent: "#DCC173" },
	hat: { from: "#FDE8EF", to: "#F7C6D9", accent: "#E79BB6" },
	generic: { from: "#FFF5F8", to: "#F3EEF1", accent: "#C79BAB" },
};

export const LABELS: Record<PlaceholderKind, string> = {
	dress: "Váy",
	maxi: "Đầm maxi",
	babydoll: "Đầm",
	tee: "Áo thun",
	shirt: "Áo",
	pants: "Quần",
	skirt: "Chân váy",
	set: "Set đồ",
	kidsdress: "Váy bé",
	shorts: "Quần short",
	hat: "Phụ kiện",
	generic: "Sản phẩm",
};

/**
 * Chọn hình theo slug danh mục.
 *
 * Nhận dạng bằng TỪ KHOÁ chứ không map cứng từng slug, vì chủ shop tự thêm
 * danh mục được — "dam-da-hoi-nu" hay "vay-cong-so-nu" đều phải ra hình váy
 * mà không cần ai sửa code.
 */
export function placeholderKind(
	categorySlug?: string | null,
	targetGroup?: "women" | "kids" | null,
): PlaceholderKind {
	// So khớp TRỌN từng đoạn giữa các dấu gạch, không khớp tiền tố. Khớp tiền tố
	// thì "danh-muc-la-nu" dính từ khoá "mu" của mũ nón và ra hình phụ kiện.
	const parts = (categorySlug ?? "").toLowerCase().split("-").filter(Boolean);
	const has = (...words: string[]) => words.some((word) => parts.includes(word));

	const kids = targetGroup === "kids" || (parts.includes("tre") && parts.includes("em"));

	if (has("chan") && has("vay")) return "skirt";
	if (has("vay", "dam", "vayr")) return kids ? "kidsdress" : "dress";
	if (has("ao", "thun", "somi")) return kids ? "tee" : "shirt";
	if (has("quan", "jean", "short", "shorts")) return kids ? "shorts" : "pants";
	if (has("set")) return "set";
	if (has("phukien", "kien", "mu", "non", "tui", "vi")) return "hat";

	return "generic";
}

/** Dựng SVG hoàn chỉnh cho một hình + bảng màu */
export function renderPlaceholderSvg(kind: PlaceholderKind, options: Palette & { label?: string }): string {
	const { from, to, accent, label } = options;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
			<stop offset="0%" stop-color="${from}"/>
			<stop offset="100%" stop-color="${to}"/>
		</linearGradient>
	</defs>
	<rect width="800" height="1000" fill="url(#bg)"/>
	<circle cx="650" cy="160" r="120" fill="#ffffff" opacity="0.35"/>
	<circle cx="140" cy="820" r="90" fill="#ffffff" opacity="0.25"/>
	<g fill="#ffffff" fill-opacity="0.85" stroke="${accent}" stroke-width="7"
	   stroke-linejoin="round" stroke-linecap="round">
		${SHAPES[kind]}
	</g>
	${
		label
			? `<text x="400" y="930" text-anchor="middle" font-family="system-ui, sans-serif"
	      font-size="30" fill="${accent}" opacity="0.85">${label}</text>`
			: ""
	}
</svg>`;
}
