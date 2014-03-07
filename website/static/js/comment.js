this.Comment = (function(window, $, ko) {

    'use strict';

    var PRIVACY_MAP = {
        'public': 'Public',
        'private': 'Private'
    };

    var ABUSE_CATEGORIES = {
        spam: 'Spam or advertising',
        hate: 'Hate speech',
        violence: 'Violence or harmful behavior'
    };

    /*
     * Format UTC datetime relative to current datetime, ensuring that time
     * is in the past.
     */
    var relativeDate = function(datetime) {
        var now = moment.utc();
        var then = moment.utc(datetime, 'MM/DD/YY HH:mm:ss');
        then = then > now ? now : then;
        return then.fromNow();
    };

    var exclusify = function(subscriber, subscribees) {
        subscriber.subscribe(function(value) {
            if (value) {
                for (var i=0; i<subscribees.length; i++) {
                    subscribees[i](false);
                }
            }
        });
    };

    var exclusifyGroup = function() {
        var observables = Array.prototype.slice.call(arguments);
        for (var i=0; i<observables.length; i++) {
            var subscriber = observables[i];
            var subscribees = observables.slice();
            subscribees.splice(i, 1);
            exclusify(subscriber, subscribees);
        }
    };

    /*
     *
     */
    var BaseComment = function() {

        var self = this;

        self.privacyOptions = Object.keys(PRIVACY_MAP);
        self.abuseOptions = Object.keys(ABUSE_CATEGORIES);

        self._loaded = false;
        self.id = ko.observable();

        self.editErrorMessage = ko.observable();
        self.replyErrorMessage = ko.observable();

        self.replying = ko.observable(false);
        self.replyContent = ko.observable('');
        self.replyPublic = ko.observable('public');

        self.comments = ko.observableArray();
        self.displayComments = ko.computed(function() {
            return ko.utils.arrayFilter(self.comments(), function(comment) {
                return !comment.isAbuse();
            });
        });

    };

    BaseComment.prototype.privacyLabel = function(item) {
        return PRIVACY_MAP[item];
    };

    BaseComment.prototype.abuseLabel = function(item) {
        return ABUSE_CATEGORIES[item];
    };

    BaseComment.prototype.showReply = function() {
        this.replying(true);
    };

    BaseComment.prototype.cancelReply = function() {
        this.replyContent('');
        this.replying(false);
        this.replyErrorMessage('');
    };

    BaseComment.prototype.setupToolTips = function(elm) {
        $(elm).each(function(idx, item) {
            var $item = $(item);
            if ($item.attr('data-toggle') === 'tooltip') {
                $item.tooltip();
            } else {
                $item.find('[data-toggle="tooltip"]').tooltip();
            }
        });
    };

    BaseComment.prototype.fetch = function() {
        var self = this;
        var deferred = $.Deferred();
        if (self._loaded) {
            deferred.resolve(self.comments());
        }
        $.getJSON(
            nodeApiUrl + 'comments/',
            {target: self.id()},
            function(response) {
                self.comments(
                    ko.utils.arrayMap(response.comments, function(comment) {
                        return new CommentModel(comment, self, self.$root);
                    })
                );
                deferred.resolve(self.comments());
                self._loaded = true;
            }
        );
        return deferred;
    };

    BaseComment.prototype.submitReply = function() {
        var self = this;
        if (!self.replyContent()) {
            self.replyErrorMessage('Please enter a comment');
            return
        }
        $.osf.postJSON(
            nodeApiUrl + 'comment/',
            {
                target: self.id(),
                content: self.replyContent(),
                isPublic: self.replyPublic()
            },
            function(response) {
                self.cancelReply();
                self.replyContent(null);
                self.comments.push(new CommentModel(response.comment, self, self.$root));
                if (!self.hasChildren()) {
                    self.hasChildren(true);
                }
                self.replyErrorMessage('');
                // Update discussion in case we aren't already in it
                // TODO: This can lead to unnecessary API calls; fix this
                if (!self.$root.commented()) {
                    self.$root.fetchDiscussion();
                    self.$root.commented(true);
                }
                self.onSubmitSuccess(response);
            }
        );
    };

    /*
     *
     */
    var CommentModel = function(data, $parent, $root) {

        BaseComment.prototype.constructor.call(this);

        var self = this;

        self.$parent = $parent;
        self.$root = $root;

        $.extend(self, ko.mapping.fromJS(data));
        self.dateCreated(data.dateCreated);
        self.dateModified(data.dateModified);

        self.prettyDateCreated = ko.computed(function() {
            return relativeDate(self.dateCreated());
        });
        self.prettyDateModified = ko.computed(function() {
            return 'Modified ' + relativeDate(self.dateModified());
        });

        self.showChildren = ko.observable(false);

        self.hoverContent = ko.observable(false);

        self.reporting = ko.observable(false);
        self.deleting = ko.observable(false);
        self.abuseCategory = ko.observable('spam');
        self.abuseText = ko.observable();

        self.editing = ko.observable(false);
        self.editVerb = self.modified ? 'edited' : 'posted';
        
        exclusifyGroup(self.editing, self.replying, self.reporting, self.deleting);

        self.showPrivateIcon = ko.computed(function() {
            return self.isPublic() === 'private';
        });
        self.toggleIcon = ko.computed(function() {
            return self.showChildren() ? 'icon-collapse-alt' : 'icon-expand-alt';
        });
        self.editHighlight = ko.computed(function() {
            return self.canEdit() && self.hoverContent();
        });

    };

    CommentModel.prototype = new BaseComment();

    CommentModel.prototype.edit = function(data) {
        if (this.canEdit()) {
            this._content = this.content();
            this._isPublic = this.isPublic();
            this.editing(true);
            this.$root.editors += 1;
        }
    };

    CommentModel.prototype.autosizeText = function(elm) {
        $(elm).find('textarea').autosize().focus();
    };

    CommentModel.prototype.cancelEdit = function() {
        this.editing(false);
        this.$root.editors -= 1;
        this.editErrorMessage('');
        this.hoverContent(false);
        this.content(this._content);
        this.isPublic(this._isPublic);
    };

    CommentModel.prototype.submitEdit = function(data, event) {
        var self = this;
        var $tips = $(event.target)
            .closest('.comment-container')
            .find('[data-toggle="tooltip"]');
        if (!self.content()) {
            self.editErrorMessage('Please enter a comment');
            return
        }
        $.osf.postJSON(
            nodeApiUrl + 'comment/' + self.id() + '/',
            {
                content: self.content(),
                isPublic: self.isPublic()
            },
            function(response) {
                self.content(response.content);
                self.dateModified(response.dateModified);
                self.editing(false);
                self.modified(true);
                self.editErrorMessage('');
                self.$root.editors -= 1;
                // Refresh tooltip on date modified, if present
                $tips.tooltip('destroy').tooltip();
            }
        ).fail(function() {
            self.cancelEdit();
        });
    };

    CommentModel.prototype.reportAbuse = function() {
        this.reporting(true);
    };

    CommentModel.prototype.cancelAbuse = function() {
        this.abuseCategory(null);
        this.abuseText(null);
        this.reporting(false);
    };

    CommentModel.prototype.submitAbuse = function() {
        var self = this;
        $.osf.postJSON(
            nodeApiUrl + 'comment/' + self.id() + '/report/',
            {
                category: self.abuseCategory(),
                text: self.abuseText()
            },
            function() {
                self.isAbuse(true);
            }
        )
    };

    CommentModel.prototype.startDelete = function() {
        this.deleting(true);
    };

    CommentModel.prototype.submitDelete = function() {
        var self = this;
        $.ajax({
            type: 'DELETE',
            url: nodeApiUrl + 'comment/' + self.id() + '/',
            success: function(response) {
                var siblings = self.$parent.comments;
                siblings.splice(siblings.indexOf(self), 1);
                self.deleting(true);
            },
            error: function() {
                self.deleting(false);
            }
        });
    };

    CommentModel.prototype.cancelDelete = function() {
        this.deleting(false);
    };

    CommentModel.prototype.startHoverContent = function() {
        this.hoverContent(true);
    };

    CommentModel.prototype.stopHoverContent = function() {
        this.hoverContent(false);
    };

    CommentModel.prototype.toggle = function () {
        this.fetch();
        this.showChildren(!this.showChildren());
    };

    CommentModel.prototype.onSubmitSuccess = function(response) {
        this.showChildren(true);
    };

    /*
     *
     */
    var CommentListModel = function(userName, canComment, hasChildren) {

        BaseComment.prototype.constructor.call(this);

        var self = this;

        self.$root = self;

        self.editors = 0;
        self.commented = ko.observable(false);
        self.userName = ko.observable(userName);
        self.canComment = ko.observable(canComment);
        self.hasChildren = ko.observable(hasChildren);
        self.discussion = ko.observableArray();

        self.replyNotEmpty = ko.computed(function() {
            return !!self.replyContent();
        });

        self.fetch();
        self.fetchDiscussion();

    };

    CommentListModel.prototype = new BaseComment();

    CommentListModel.prototype.onSubmitSuccess = function() {};

    CommentListModel.prototype.fetchDiscussion = function() {
        var self = this;
        $.getJSON(
            nodeApiUrl + 'comments/discussion/',
            function(response) {
                self.discussion(response.discussion);
            }
        )
    };

    CommentListModel.prototype.initListeners = function() {
        var self = this;
        $(window).on('beforeunload', function() {
            if (self.editors) {
                return 'Your comments have unsaved changes. Are you sure ' +
                    'you want to leave this page?';
            }
        });
    };

    var init = function(selector, userName, canComment, hasChildren) {
        var viewModel = new CommentListModel(userName, canComment, hasChildren);
        var $elm = $(selector);
        if (!$elm.length) {
            throw('No results found for selector');
        }
        ko.applyBindings(viewModel, $elm[0]);
        viewModel.initListeners();
    };

    return {
        init: init
    }

})(window, $, ko);