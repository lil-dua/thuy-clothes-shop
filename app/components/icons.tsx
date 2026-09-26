/**
 * Icon vẽ trực tiếp bằng SVG thay vì cài thư viện icon:
 * bundle nhỏ hơn cho khách dùng 3G/4G, và stroke đồng bộ toàn site.
 */

type IconProps = React.SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			{children}
		</svg>
	);
}

export const SearchIcon = (props: IconProps) => (
	<Icon {...props}>
		<circle cx="11" cy="11" r="7" />
		<path d="m20 20-3.5-3.5" />
	</Icon>
);

export const CartIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 8H6" />
		<circle cx="10" cy="20" r="1.4" />
		<circle cx="17" cy="20" r="1.4" />
	</Icon>
);

export const HeartIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M12 20s-7-4.3-7-9.2A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.8c0 4.9-7 9.2-7 9.2Z" />
	</Icon>
);

export const HomeIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" />
	</Icon>
);

export const GridIcon = (props: IconProps) => (
	<Icon {...props}>
		<rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
		<rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
		<rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
		<rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
	</Icon>
);

export const ReceiptIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21Z" />
		<path d="M9.5 8h5M9.5 12h5" />
	</Icon>
);

export const UserIcon = (props: IconProps) => (
	<Icon {...props}>
		<circle cx="12" cy="8.5" r="3.5" />
		<path d="M5 20a7 7 0 0 1 14 0" />
	</Icon>
);

export const MenuIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 7h16M4 12h16M4 17h16" />
	</Icon>
);

export const CloseIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M6 6l12 12M18 6 6 18" />
	</Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="m6 9 6 6 6-6" />
	</Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="m9 6 6 6-6 6" />
	</Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="m15 6-6 6 6 6" />
	</Icon>
);

export const PlusIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M12 5v14M5 12h14" />
	</Icon>
);

export const MinusIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M5 12h14" />
	</Icon>
);

export const TrashIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
	</Icon>
);

export const CheckIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="m5 13 4.5 4.5L19 7" />
	</Icon>
);

export const StarIcon = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
	<Icon fill={filled ? "currentColor" : "none"} {...props}>
		<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8Z" />
	</Icon>
);

export const TruckIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M3 7h10v9H3zM13 10h4l3 3v3h-7z" />
		<circle cx="7" cy="18" r="1.6" />
		<circle cx="17" cy="18" r="1.6" />
	</Icon>
);

export const ShieldIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6Z" />
		<path d="m9 12 2 2 4-4" />
	</Icon>
);

export const RefreshIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 12a8 8 0 0 1-13.7 5.6L4 16" />
		<path d="M20 4v4h-4M4 20v-4h4" />
	</Icon>
);

export const PackageIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2Z" />
		<path d="M4 7.2 12 11.5l8-4.3M12 11.5V21" />
	</Icon>
);

export const ChartIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 20h16" />
		<path d="M7 20v-6M12 20V6M17 20v-9" />
	</Icon>
);

export const TagIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 12.5V5a1 1 0 0 1 1-1h7.5L21 12.5 12.5 21Z" />
		<circle cx="8.5" cy="8.5" r="1.4" />
	</Icon>
);

export const SettingsIcon = (props: IconProps) => (
	<Icon {...props}>
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.2a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" />
	</Icon>
);

export const UsersIcon = (props: IconProps) => (
	<Icon {...props}>
		<circle cx="9" cy="8" r="3.2" />
		<path d="M3 19a6 6 0 0 1 12 0" />
		<path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a6 6 0 0 0-2-4.5" />
	</Icon>
);

export const LogoutIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
		<path d="M10 8 6 12l4 4M6 12h9" />
	</Icon>
);

export const FilterIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 6h16M7 12h10M10 18h4" />
	</Icon>
);

export const UploadIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M12 16V5m0 0L8 9m4-4 4 4" />
		<path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
	</Icon>
);

export const EditIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" />
		<path d="m14.5 6.5 3 3" />
	</Icon>
);

export const AlertIcon = (props: IconProps) => (
	<Icon {...props}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 8v4.5M12 16h.01" />
	</Icon>
);

/** Bong bóng chat — dùng cho nút nhắn Zalo ở storefront */
export const ChatIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-2.8-.4L4 21l1.4-4.1A8.2 8.2 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
		<path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
	</Icon>
);

export const ArrowUpIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M12 19V5m0 0-6 6m6-6 6 6" />
	</Icon>
);

export const ArrowDownIcon = (props: IconProps) => (
	<Icon {...props}>
		<path d="M12 5v14m0 0 6-6m-6 6-6-6" />
	</Icon>
);
