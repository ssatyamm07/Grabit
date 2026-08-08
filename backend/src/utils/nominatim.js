export function parseNominatimReverse(data) {
	const addr = data?.address ?? {};
	const house = addr.house_number ?? '';
	const road = addr.road ?? addr.street ?? addr.pedestrian ?? addr.residential ?? '';
	const suburb =
		addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.locality ?? addr.hamlet ?? '';
	const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? '';
	const state = addr.state ?? '';
	const postcode = addr.postcode ?? '';

	const line1 = [house, road].filter(Boolean).join(', ');
	const areaParts = [suburb, city, postcode].filter(Boolean);
	const area = areaParts.join(', ');
	const shortLabel =
		suburb || city || line1 || data?.display_name?.split(',')[0]?.trim() || 'Selected location';

	return {
		line1: line1 || shortLabel,
		area: area || city || state || '',
		city,
		state,
		postcode,
		short_label: shortLabel,
		display_name: data?.display_name ?? '',
	};
}

export function parseNominatimSearchResult(item) {
	const latitude = Number.parseFloat(item.lat);
	const longitude = Number.parseFloat(item.lon);
	const parsed = parseNominatimReverse(item);
	const label = item.name || parsed.short_label || parsed.line1;

	return {
		id: String(item.place_id ?? `${latitude},${longitude}`),
		label,
		subtitle: item.display_name ?? parsed.display_name,
		latitude,
		longitude,
		...parsed,
	};
}
