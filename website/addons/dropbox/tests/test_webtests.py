# -*- coding: utf-8 -*-
from nose.tools import *  # noqa (PEP8 asserts)

from website.util import api_url_for, web_url_for
from tests.base import OsfTestCase
from tests.factories import AuthUserFactory


class TestDropboxIntegration(OsfTestCase):

    def setUp(self):
        super(TestDropboxIntegration, self).setUp()
        self.user = AuthUserFactory()
        # User is logged in
        self.app.authenticate(*self.user.auth)

    def test_cant_start_oauth_if_already_authorized(self):
        # User already has dropbox authorized
        self.user.add_addon('dropbox')
        self.user.save()
        settings = self.user.get_addon('dropbox')
        settings.access_token = 'abc123foobarbaz'
        settings.save()
        assert_true(self.user.get_addon('dropbox').has_auth)
        # Tries to start oauth again
        url = api_url_for('dropbox_oauth_start_user')
        res = self.app.get(url).follow()

        # Is redirected back to settings page
        assert_equal(
            res.request.path,
            web_url_for('user_addons')
        )
