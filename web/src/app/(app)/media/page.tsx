// /media — Media module index. Redirects to the most useful sub-view.

import { redirect } from 'next/navigation';

export default function MediaIndexPage() {
	redirect('/media/opps');
}
