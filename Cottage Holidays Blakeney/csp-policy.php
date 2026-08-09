<?php
// AUTO-GENERATED from htaccess.txt — do NOT edit by hand.
// Regenerate:  php test-csp-report.php --update
//
// csp-report.php needs the live policy to tell a genuine block from a
// stale-client straggler, and reading it from the filesystem at request
// time does not work in production: deploy.yml renames htaccess.txt to
// .htaccess, so only a dotfile remains and PHP may not be permitted to
// read it. An include always works. Parity with htaccess.txt is gated by
// test-csp-report.php, so this file cannot drift from the real header.
return 'default-src \'self\'; script-src \'self\' \'unsafe-eval\' \'sha256-XO9NLu1ehyc6nzHO1YBt2XqOhnCY/70e7MeZtijphUM=\' \'sha256-NrQFug5+g7+8jo3l8nU4xzeOhEh4M/HB1/EDsRvjQew=\' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://*.squarecdn.com https://pay.google.com; worker-src \'self\' blob: https://cdn.jsdelivr.net; child-src \'self\' blob: https://cdn.jsdelivr.net; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://*.squarecdn.com; font-src \'self\' data: https://fonts.gstatic.com https://*.squarecdn.com https://d1g145x70srn7h.cloudfront.net; img-src \'self\' data: blob: https://cdnjs.cloudflare.com https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.squarecdn.com https://*.gstatic.com; connect-src \'self\' blob: https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://*.squarecdn.com https://connect.squareup.com https://connect.squareupsandbox.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://pay.google.com https://google.com https://*.google.com https://spay.samsung.com; frame-src https: blob:; frame-ancestors \'self\'; base-uri \'self\'; form-action \'self\' https:; object-src \'none\'; upgrade-insecure-requests; report-uri /csp-report.php';
