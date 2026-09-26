import { Link, redirect } from "react-router";
import type { Route } from "./+types/policy";
import { getSettings } from "~/lib/settings.server";
import { formatVnd } from "~/lib/format";

/**
 * Trang chính sách.
 *
 * Nội dung dựng từ Cài đặt chứ không viết cứng: đổi phí ship hay số ngày đổi
 * trả trong trang quản trị là chính sách đổi theo. Chính sách nói một đằng mà
 * trang thanh toán tính một nẻo là nguồn khiếu nại chắc chắn.
 */

const PAGES = {
	"doi-tra": "Chính sách đổi trả",
	"van-chuyen": "Chính sách vận chuyển",
	"bao-mat": "Chính sách bảo mật",
} as const;

type PolicySlug = keyof typeof PAGES;

export function meta({ data }: Route.MetaArgs) {
	return [
		{ title: `${data?.title ?? "Chính sách"} — ${data?.shopName ?? "Lumi"}` },
		{ name: "description", content: data?.title ?? "Chính sách của shop" },
	];
}

export async function loader({ params, context }: Route.LoaderArgs) {
	const slug = params.slug as PolicySlug;
	if (!(slug in PAGES)) throw redirect("/chinh-sach/doi-tra");

	const settings = await getSettings(context.cloudflare.env.DB);

	return {
		slug,
		title: PAGES[slug],
		shopName: settings.shop_name,
		returnDays: settings.return_policy_days,
		shippingFee: Number.parseInt(settings.shipping_fee, 10) || 0,
		freeThreshold: Number.parseInt(settings.free_shipping_threshold, 10) || 0,
		holdMinutes: settings.order_hold_minutes,
		phone: settings.shop_phone,
		email: settings.shop_email,
	};
}

export default function Policy({ loaderData }: Route.ComponentProps) {
	const data = loaderData;

	return (
		<div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
			<nav className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
				{(Object.keys(PAGES) as PolicySlug[]).map((slug) => (
					<Link
						key={slug}
						to={`/chinh-sach/${slug}`}
						className={`chip ${data.slug === slug ? "chip-active" : ""}`}
					>
						{PAGES[slug]}
					</Link>
				))}
			</nav>

			<h1 className="text-2xl font-bold text-ink-900">{data.title}</h1>

			<div className="mt-5 space-y-5 text-sm leading-relaxed text-ink-700">
				{data.slug === "doi-tra" && <ReturnPolicy data={data} />}
				{data.slug === "van-chuyen" && <ShippingPolicy data={data} />}
				{data.slug === "bao-mat" && <PrivacyPolicy data={data} />}
			</div>

			<div className="mt-8 rounded-xl bg-brand-50/60 p-4 text-sm">
				<p className="font-medium text-ink-800">Cần hỗ trợ?</p>
				<p className="mt-1 text-ink-600">
					{data.phone && (
						<>
							Gọi{" "}
							<a href={`tel:${data.phone}`} className="font-semibold text-brand-600">
								{data.phone}
							</a>
						</>
					)}
					{data.phone && data.email && " · "}
					{data.email && (
						<a href={`mailto:${data.email}`} className="font-semibold text-brand-600">
							{data.email}
						</a>
					)}
					{!data.phone && !data.email && "Nhắn cho shop qua Zalo hoặc Threads."}
				</p>
			</div>
		</div>
	);
}

type Data = Route.ComponentProps["loaderData"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section>
			<h2 className="mb-1.5 font-semibold text-ink-900">{title}</h2>
			{children}
		</section>
	);
}

function ReturnPolicy({ data }: { data: Data }) {
	return (
		<>
			<Section title={`Thời hạn đổi trả: ${data.returnDays} ngày`}>
				<p>
					Tính từ ngày bạn nhận được hàng. Quá thời hạn này {data.shopName} rất tiếc
					không tiếp nhận yêu cầu đổi trả.
				</p>
			</Section>

			<Section title="Trường hợp được đổi trả">
				<ul className="list-disc space-y-1 pl-5">
					<li>Sản phẩm bị lỗi từ nhà sản xuất: rách, bung chỉ, lệch form, phai màu</li>
					<li>Giao sai mẫu, sai size, sai màu so với đơn đã đặt</li>
					<li>Sản phẩm thiếu so với đơn hàng</li>
				</ul>
			</Section>

			<Section title="Điều kiện">
				<ul className="list-disc space-y-1 pl-5">
					<li>Sản phẩm còn nguyên tem mác, chưa qua sử dụng và chưa giặt</li>
					<li>Còn đủ phụ kiện, quà tặng kèm theo (nếu có)</li>
					<li>Có hình ảnh hoặc video chứng minh lỗi, chụp khi vừa mở gói</li>
				</ul>
				<p className="mt-2 text-ink-600">
					Nên quay video lúc mở gói hàng — đây là cách nhanh nhất để shop xử lý cho bạn
					mà không phải hỏi qua hỏi lại.
				</p>
			</Section>

			<Section title="Chi phí">
				<p>
					Lỗi từ phía shop: {data.shopName} chịu toàn bộ phí chuyển hoàn và gửi lại.
					Đổi vì lý do cá nhân (không hợp, đổi ý): bạn chịu phí vận chuyển hai chiều.
				</p>
			</Section>

			<Section title="Cách thực hiện">
				<p>
					Liên hệ shop trong thời hạn nêu trên, kèm mã đơn hàng và hình ảnh sản phẩm.
					Shop xác nhận rồi hướng dẫn bạn gửi hàng về.
				</p>
			</Section>
		</>
	);
}

function ShippingPolicy({ data }: { data: Data }) {
	return (
		<>
			<Section title="Phạm vi giao hàng">
				<p>Toàn quốc, qua các đơn vị vận chuyển phổ biến.</p>
			</Section>

			<Section title="Phí vận chuyển">
				<p>
					{data.shippingFee > 0
						? `${formatVnd(data.shippingFee)} cho mọi đơn hàng.`
						: "Miễn phí vận chuyển."}
					{data.freeThreshold > 0 &&
						` Miễn phí với đơn từ ${formatVnd(data.freeThreshold)} trở lên.`}
				</p>
			</Section>

			<Section title="Thời gian giao">
				<p>
					Nội thành 1–2 ngày, các tỉnh 2–5 ngày làm việc kể từ khi shop xác nhận đơn.
					Thời gian có thể lâu hơn vào dịp lễ Tết hoặc khi thời tiết xấu.
				</p>
			</Section>

			<Section title="Thanh toán">
				<ul className="list-disc space-y-1 pl-5">
					<li>
						<strong>COD</strong> — trả tiền mặt khi nhận hàng
					</li>
					<li>
						<strong>Chuyển khoản</strong> — quét mã QR hiện sau khi đặt. Đơn được giữ
						hàng {data.holdMinutes} phút; quá hạn chưa nhận được thanh toán, đơn tự huỷ
						và hàng trả lại kho
					</li>
					<li>
						<strong>MoMo</strong> — quét mã QR tương tự chuyển khoản
					</li>
				</ul>
			</Section>

			<Section title="Kiểm tra hàng">
				<p>
					Bạn được kiểm tra hàng trước khi thanh toán. Nếu sản phẩm không đúng mô tả,
					vui lòng từ chối nhận và báo shop ngay.
				</p>
			</Section>
		</>
	);
}

function PrivacyPolicy({ data }: { data: Data }) {
	return (
		<>
			<Section title="Thông tin shop thu thập">
				<p>
					Chỉ những gì cần để giao được hàng: họ tên, số điện thoại, địa chỉ nhận hàng,
					và email nếu bạn tự điền. Shop <strong>không</strong> yêu cầu bạn tạo tài khoản
					và <strong>không</strong> lưu bất kỳ thông tin thẻ ngân hàng nào — mọi giao dịch
					chuyển khoản diễn ra trực tiếp trong ứng dụng ngân hàng của bạn.
				</p>
			</Section>

			<Section title="Mục đích sử dụng">
				<ul className="list-disc space-y-1 pl-5">
					<li>Xử lý và giao đơn hàng</li>
					<li>Liên hệ khi cần xác nhận hoặc có vấn đề với đơn</li>
					<li>Gửi email xác nhận đơn, nếu bạn để lại email</li>
				</ul>
			</Section>

			<Section title="Chia sẻ với bên thứ ba">
				<p>
					Chỉ chia sẻ tên, số điện thoại và địa chỉ với đơn vị vận chuyển để giao hàng.
					Shop không bán, không trao đổi thông tin của bạn cho bất kỳ ai khác.
				</p>
			</Section>

			<Section title="Xem lại đơn hàng của bạn">
				<p>
					Trang theo dõi đơn chỉ mở cho người biết mã đơn <em>và</em> số điện thoại đã
					đặt, nên người khác có mã đơn cũng không xem được thông tin của bạn.
				</p>
			</Section>

			<Section title="Xoá thông tin">
				<p>
					Bạn có thể yêu cầu {data.shopName} xoá thông tin cá nhân bất cứ lúc nào bằng
					cách liên hệ theo thông tin bên dưới. Shop sẽ giữ lại dữ liệu đơn hàng đã hoàn
					tất trong phạm vi cần thiết cho việc đối soát và bảo hành.
				</p>
			</Section>
		</>
	);
}
