# The demo film's take runner (V1). The root Makefile is the product's; this one is the film's.
#   make -C video take SCENE=2.4          # re-record one scene (setup off camera, pre-roll, film)
#   make -C video take SCENE=3.1 DRY=1    # rehearse: stop before anything that spends a subscription
#   make -C video take SCENE="3.2*"       # every take of a scene (its parts too)
#   make -C video list                    # the scene registry
#   make -C video up | down | reset       # the filming stack on tvashtr_film
#   make -C video contact-sheet ch2-preview
SCENE ?=
DRY ?=

.PHONY: take list up down reset contact-sheet ch2-preview

take:
	@test -n "$(SCENE)" || { echo "usage: make -C video take SCENE=<id> [DRY=1]"; exit 2; }
	caffeinate -dimsu node camera/take.mjs $(SCENE) $(if $(DRY),--dry)

list:
	@node camera/take.mjs list

up:
	stack/up
down:
	stack/down
reset:
	stack/reset

contact-sheet:
	node camera/sheet.mjs contact-sheet

ch2-preview:
	node camera/sheet.mjs ch2-preview
