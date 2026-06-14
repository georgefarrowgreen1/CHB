This folder holds photos uploaded through the Live Editor's file finder.

You don't need to put anything here yourself — the site creates files here when
you upload images in edit mode. It must be WRITABLE by the web server
(permissions 755 usually work on IONOS; if uploads fail, try 775).

The .htaccess file in this folder is a security measure: it lets images be
served but stops anything here from being run as a script. Leave it in place.
