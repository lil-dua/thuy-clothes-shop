import { Link } from "react-router";
import { cn, formatCompactVnd, formatVnd } from "~/lib/format";
import type { RevenuePoint } from "~/lib/stats.server";
import {
	ORDER_STATUS_LABEL,
	PAYMENT_STATUS_LABEL,
	type OrderStatus,
	type PaymentStatus,
} from "~/lib/types";
import { ArrowDownIcon, ArrowUpIcon } from "~/components/icons";

/** Tiêu đề trang quản trị + hành động bên phải */
export function PageHeader({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 className="text-xl font-bold text-ink-900 lg:text-2xl">{title}</h1>
				{description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
			</div>
			{action}
		</div>
	);
}

export function StatCard({
	label,
	value,
	change,
	hint,
}: {
	label: string;
	value: string;
	change?: number | null;
	hint?: string;
}) {
	return (
		<div className="card p-4">
			<p className="text-sm text-ink-500">{label}</p>
			<p className="mt-1 text-2xl font-bold text-ink-900">{value}</p>
			{change != null ? (
				<p
					className={cn(
						"mt-1 flex items-center gap-1 text-xs font-medium",
						change >= 0 ? "text-green-600" : "text-red-600",
					)}
				>
					{change >= 0 ? (
						<ArrowUpIcon className="h-3.5 w-3.5" />
					) : (
						<ArrowDownIcon className="h-3.5 w-3.5" />
					)}
					{Math.abs(change)}% so với kỳ trước
				</p>
			) : (
				hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>
			)}
		</div>
	);
}

const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
	pending: "bg-amber-100 text-amber-700",
	confirmed: "bg-blue-100 text-blue-700",
	shipping: "bg-violet-100 text-violet-700",
	delivered: "bg-green-100 text-green-700",
	cancelled: "bg-red-100 text-red-700",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
	return (
		<span className={cn("badge", ORDER_STATUS_STYLE[status])}>
			{ORDER_STATUS_LABEL[status]}
		</span>
	);
}

const PAYMENT_STATUS_STYLE: Record<PaymentStatus, string> = {
	pending: "bg-ink-100 text-ink-600",
	paid: "bg-green-100 text-green-700",
	failed: "bg-red-100 text-red-700",
	refunded: "bg-orange-100 text-orange-700",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
	return (
		<span className={cn("badge", PAYMENT_STATUS_STYLE[status])}>
			{PAYMENT_STATUS_LABEL[status]}
		</span>
	);
}

/**
 * Biểu đồ doanh thu vẽ thẳng bằng SVG — không kéo theo thư viện chart,
 * và vẽ được ngay trên server nên không nhấp nháy khi tải trang.
 */
export function RevenueChart({ points }: { points: RevenuePoint[] }) {
	if (points.length === 0) {
		return (
			<p className="grid h-48 place-items-center text-sm text-ink-400">
				Chưa có dữ liệu doanh thu trong kỳ này.
			</p>
		);
	}

	const width = 640;
	const height = 200;
	const padding = { top: 12, right: 8, bottom: 22, left: 46 };
	const innerWidth = width - padding.left - padding.right;
	const innerHeight = height - padding.top - padding.bottom;

	const max = Math.max(...points.map((point) => point.revenue), 1);
	const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;

	const coords = points.map((point, index) => ({
		x: padding.left + index * stepX,
		y: padding.top + innerHeight - (point.revenue / max) * innerHeight,
		point,
	}));

	const line = coords.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
	const area = `${padding.left},${padding.top + innerHeight} ${line} ${(
		padding.left + (points.length - 1) * stepX
	).toFixed(1)},${padding.top + innerHeight}`;

	// 4 mốc trục tung, làm tròn cho dễ đọc
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
		value: max * ratio,
		y: padding.top + innerHeight - ratio * innerHeight,
	}));

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			className="h-48 w-full"
			role="img"
			aria-label="Biểu đồ doanh thu theo ngày"
		>
			<defs>
				<linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="var(--color-brand-400)" stopOpacity="0.28" />
					<stop offset="100%" stopColor="var(--color-brand-400)" stopOpacity="0" />
				</linearGradient>
			</defs>

			{ticks.map(({ value, y }) => (
				<g key={y}>
					<line
						x1={padding.left}
						y1={y}
						x2={width - padding.right}
						y2={y}
						stroke="var(--color-ink-200)"
						strokeWidth="1"
						strokeDasharray="3 3"
					/>
					<text
						x={padding.left - 8}
						y={y + 4}
						textAnchor="end"
						fontSize="10"
						fill="var(--color-ink-400)"
					>
						{value === 0 ? "0" : formatCompactVnd(value)}
					</text>
				</g>
			))}

			<polygon points={area} fill="url(#revenue-fill)" />
			<polyline
				points={line}
				fill="none"
				stroke="var(--color-brand-500)"
				strokeWidth="2"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>

			{coords.map(({ x, y, point }) => (
				<g key={point.day}>
					<circle cx={x} cy={y} r="3" fill="var(--color-brand-500)" />
					<title>{`${point.day}: ${formatVnd(point.revenue)} (${point.orders} đơn)`}</title>
				</g>
			))}

			{/* Nhãn trục ngày: chỉ vẽ tối đa 6 mốc để không chồng chữ */}
			{coords
				.filter((_, index) => index % Math.ceil(points.length / 6) === 0)
				.map(({ x, point }) => (
					<text
						key={point.day}
						x={x}
						y={height - 6}
						textAnchor="middle"
						fontSize="10"
						fill="var(--color-ink-400)"
					>
						{point.day.slice(8)}/{point.day.slice(5, 7)}
					</text>
				))}
		</svg>
	);
}

/** Khung bảng cuộn ngang — bảng admin thường rộng hơn màn hình laptop nhỏ */
export function TableWrap({ children }: { children: React.ReactNode }) {
	return (
		<div className="card overflow-hidden">
			<div className="overflow-x-auto">{children}</div>
		</div>
	);
}

export function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="px-4 py-14 text-center">
			<p className="font-medium text-ink-700">{title}</p>
			{description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

export function Pagination({
	page,
	pageCount,
	buildLink,
}: {
	page: number;
	pageCount: number;
	buildLink: (page: number) => string;
}) {
	if (pageCount <= 1) return null;
	const start = Math.max(1, Math.min(page - 2, pageCount - 4));
	const numbers = Array.from({ length: Math.min(5, pageCount) }, (_, i) => start + i);

	return (
		<nav
			className="flex items-center justify-end gap-1.5 border-t border-ink-200 px-4 py-3"
			aria-label="Phân trang"
		>
			{numbers.map((number) => (
				<Link
					key={number}
					to={buildLink(number)}
					aria-current={number === page ? "page" : undefined}
					className={cn(
						"grid h-8 w-8 place-items-center rounded-lg text-sm font-medium",
						number === page ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-100",
					)}
				>
					{number}
				</Link>
			))}
		</nav>
	);
}
