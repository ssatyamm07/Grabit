function pickComponent(components, type) {
	return components.find((component) => component.types?.includes(type))?.long_name ?? '';
}

export function parseGoogleGeocodeResult(result, latitude, longitude) {
	const components = result?.address_components ?? [];
	const house = pickComponent(components, 'street_number');
	const road =
		pickComponent(components, 'route') ||
		pickComponent(components, 'street_address') ||
		pickComponent(components, 'premise');
	const suburb =
		pickComponent(components, 'sublocality_level_1') ||
		pickComponent(components, 'sublocality') ||
		pickComponent(components, 'neighborhood');
	const city =
		pickComponent(components, 'locality') ||
		pickComponent(components, 'administrative_area_level_2') ||
		pickComponent(components, 'administrative_area_level_3');
	const state = pickComponent(components, 'administrative_area_level_1');
	const postcode = pickComponent(components, 'postal_code');

	const line1 = [house, road].filter(Boolean).join(', ');
	const areaParts = [suburb, city, postcode].filter(Boolean);
	const area = areaParts.join(', ');
	const shortLabel =
		suburb ||
		city ||
		line1 ||
		result?.formatted_address?.split(',')[0]?.trim() ||
		'Selected location';

	return {
		line1: line1 || shortLabel,
		area: area || city || state || '',
		city,
		state,
		postcode,
		short_label: shortLabel,
		display_name: result?.formatted_address ?? '',
		latitude,
		longitude,
	};
}

export function parseGoogleSearchResult(result) {
	const location = result?.geometry?.location ?? {};
	const latitude = Number(location.lat);
	const longitude = Number(location.lng);
	const parsed = parseGoogleGeocodeResult(result, latitude, longitude);
	const label = result?.address_components?.find((component) =>
		component.types?.includes('establishment')
	)?.long_name;

	return {
		id: String(result.place_id ?? `${latitude},${longitude}`),
		label: label || parsed.short_label || parsed.line1,
		subtitle: parsed.display_name,
		latitude,
		longitude,
		...parsed,
	};
}
