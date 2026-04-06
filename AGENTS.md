get context from the README

Optimizing for ease, clarity, and speed. Really trying to make patterns in your codebase established early that are easy to make contributions to, that are clear in what they do, and are fast to change. Ideally a small change should only have to touch a small number of files and a big change should probably have to touch a big number of files.

Common mistake I see is people are getting their codebase so big that changes are simple and as a result the small changes become really really complex. So common. If small changes and big changes take the same amount of effort, you fucked up both sides. This is so common.

This is also why things like Tailwind are so cool because it reduces the number of services that have to be hit to make a change. This is also why things like GraphQL are bad because you have to touch way more shit to just add a little bit of information to your UI.

Optimizing your codebase so that it is easier to understand what's going on, clearer as well, and fast to make contributions to is great. There's a bigger piece here that I really want to emphasize: tolerate nothing. If a bad pattern makes it in it will multiply. Bad code multiplies way way faster than good code does because the bad code wouldn't have made it in if it wasn't convenient. Bad code and convenient code have a lot of overlapping characteristics but bad code multiplies too aggressively to ever ever let it in. You have to be strict about this.

You can't make the exception of "well we need to hit this deadline so we know this is slow but we'll fix it later." Later is another word for never in the software development world. You're not going to fix the thing so don't tolerate it. Don't let it in the codebase. Along those lines if you do stumble upon something bad, if you do find something in the codebase that smells, don't hesitate, don't look into the history, don't question why it's there. Murder it with intensity. There is no room in our codebases for slop. It spreads too fast.

If you do happen to stumble upon it, drop everything to kill it. I don't care what deadline gets missed. I don't care what manager is bad. I don't care what agent is insisting that it's totally fine. If it smells it is bad and if it is bad it should be removed. No tolerance. This does mean you have to pay more attention a bit. Not that you have to read every line of code but you need to keep an eye on the general patterns that your codebase is evolving.
