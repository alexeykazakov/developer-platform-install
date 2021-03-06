'use strict';

import chai, { expect } from 'chai';
import sinon from 'sinon';
import { default as sinonChai } from 'sinon-chai';
import mockfs from 'mock-fs';
import request from 'request';
import fs from 'fs';
import path from 'path';
import VirtualBoxInstall from 'model/virtualbox';
import Logger from 'services/logger';
import Downloader from 'model/helpers/downloader';
import Installer from 'model/helpers/installer';
import Util from 'model/helpers/util';
chai.use(sinonChai);

let child_process = require('child_process');

describe('Virtualbox installer', function() {
  let installerDataSvc, installer;
  let infoStub, errorStub, sandbox;
  let fakeData = {
    tempDir: function() { return 'tempDirectory'; },
    installDir: function() { return 'installationFolder'; },
    virtualBoxDir: function() { return 'installationFolder/virtualbox'; }
  };

  let downloadUrl = 'http://download.virtualbox.org/virtualbox/${version}/VirtualBox-${version}-${revision}-Win.exe',
      version = '5.0.8',
      revision = '103449',
      finalUrl = 'http://download.virtualbox.org/virtualbox/5.0.8/VirtualBox-5.0.8-103449-Win.exe';

  installerDataSvc = sinon.stub(fakeData);
  installerDataSvc.tempDir.returns('tempDirectory');
  installerDataSvc.installDir.returns('installationFolder');
  installerDataSvc.virtualBoxDir.returns('installationFolder/virtualbox');

  let fakeProgress = {
    setStatus: function (desc) { return; },
    setCurrent: function (val) {},
    setLabel: function (label) {},
    setComplete: function() {},
    setTotalDownloadSize: function(size) {},
    downloaded: function(amt, time) {}
  };

  before(function() {
    infoStub = sinon.stub(Logger, 'info');
    errorStub = sinon.stub(Logger, 'error');

    mockfs({
      tempDirectory: {},
      installationFolder: {}
    }, {
      createCwd: false,
      createTmp: false
    });
  });

  after(function() {
    mockfs.restore();
    infoStub.restore();
    errorStub.restore();
  });

  beforeEach(function () {
    installer = new VirtualBoxInstall(version, revision, installerDataSvc, downloadUrl, null);
    sandbox = sinon.sandbox.create();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should not download virtualbox when an installation exists', function() {
    let jdk = new VirtualBoxInstall('ver', 'rev', installerDataSvc, 'url', 'file');
    expect(jdk.useDownload).to.be.false;
  });

  it('should fail when no url is set and installed file not defined', function() {
    expect(function() {
      new VirtualBoxInstall('ver', 'rev', installerDataSvc, null, null);
    }).to.throw('No download URL set');
  });

  it('should fail when no url is set and installed file is empty', function() {
    expect(function() {
      new VirtualBoxInstall('ver', 'rev', installerDataSvc, null, '');
    }).to.throw('No download URL set');
  });

  it('should download virtualbox when no installation is found', function() {
    expect(new VirtualBoxInstall('ver', 'rev', installerDataSvc, 'url', null).useDownload).to.be.true;
  });

  it('should download virtualbox installer to temporary folder as virtualbox.exe', function() {
    expect(new VirtualBoxInstall('ver', 'rev', installerDataSvc, 'url', null).downloadedFile).to.equal(
      path.join(installerDataSvc.tempDir(), 'virtualbox.exe'));
  });

  describe('installer download', function() {
    let downloadStub;

    beforeEach(function() {
      downloadStub = sandbox.stub(Downloader.prototype, 'download').returns();
    });

    it('should set progress to "Downloading"', function() {
      let spy = sandbox.spy(fakeProgress, 'setStatus');

      installer.downloadInstaller(fakeProgress, function() {}, function() {});

      expect(spy).to.have.been.calledOnce;
      expect(spy).to.have.been.calledWith('Downloading');
    });

    it('should write the data into temp/virtualbox.exe', function() {
      let spy = sandbox.spy(fs, 'createWriteStream');

      installer.downloadInstaller(fakeProgress, function() {}, function() {});

      expect(spy).to.have.been.calledOnce;
      expect(spy).to.have.been.calledWith(path.join('tempDirectory', 'virtualbox.exe'));
    });

    it('should call downloader#download with the specified parameters once', function() {
      installer.downloadInstaller(fakeProgress, function() {}, function() {});

      expect(downloadStub).to.have.been.calledOnce;
      expect(downloadStub).to.have.been.calledWith(finalUrl);
    });

    it('should skip download when the file is found in the download folder', function() {
      sandbox.stub(fs, 'existsSync').returns(true);

      installer.downloadInstaller(fakeProgress, function() {}, function() {});

      expect(downloadStub).not.called;
    });
  });

  describe('installation', function() {
    let downloadedFile = path.join('tempDirectory', 'virtualbox.exe');

    it('should execute the silent extract', function() {
      let stub = sandbox.stub(child_process, 'execFile').yields('done');

      let data = [
        '--extract',
        '-path',
        installerDataSvc.tempDir(),
        '--silent'
      ];

      let spy = sandbox.spy(Installer.prototype, 'execFile');
      installer.install(fakeProgress, function() {}, function (err) {});

      expect(spy).to.have.been.called;
      expect(spy).calledWith(downloadedFile, data);
    });

    it('setup should wait for all downloads to complete', function() {
      let helper = new Installer('virtualbox', fakeProgress);
      let spy = sandbox.spy(installer, 'installMsi');
      let progressSpy = sandbox.spy(fakeProgress, 'setStatus');

      installerDataSvc.downloading = true;

      installer.configure(helper);

      expect(progressSpy).calledWith('Waiting for all downloads to finish');
      expect(spy).not.called;
    });

    it('should catch errors during the installation', function(done) {
      let stub = sandbox.stub(child_process, 'execFile').yields(new Error('critical error'));

      try {
        installer.install(fakeProgress, function() {}, function (err) {});
        done();
      } catch (error) {
        expect.fail('it did not catch the error');
      }
    });

    it('should skip installation when an existing version is used', function() {
      installer.selectedOption = 'detect';
      let spy = sandbox.spy(Installer.prototype, 'execFile');

      installer.install(fakeProgress, function() {}, function (err) {});

      expect(spy).to.have.not.been.called;
    });

    describe('configure', function() {
      it('should call installMsi if all downloads have finished', function() {
        let helper = new Installer('virtualbox', fakeProgress);
        let spy = sandbox.spy(installer, 'installMsi');
        sandbox.stub(child_process, 'execFile').yields();

        installerDataSvc.downloading = false;

        installer.configure(helper);
        expect(spy).calledOnce;
      });
    });

    describe('installMsi', function() {
      let helper;

      beforeEach(function() {
        helper = new Installer('virtualbox', fakeProgress);
        sandbox.stub(child_process, 'execFile').yields('done');
      });

      it('should set progress to "Installing"', function() {
        let spy = sandbox.spy(fakeProgress, 'setStatus');

        installer.installMsi(helper);

        expect(spy).to.have.been.calledOnce;
        expect(spy).to.have.been.calledWith('Installing');
      });

      it('should execute the msi installer', function() {
        let spy = sandbox.spy(Installer.prototype, 'execFile');

        let msiFile = path.join(installerDataSvc.tempDir(), 'VirtualBox-' + version + '-r' + revision + '-MultiArch_amd64.msi')
        let opts = [
          '/i',
          msiFile,
          'INSTALLDIR=' + installerDataSvc.virtualBoxDir(),
          '/qb!',
          '/norestart',
          '/Liwe',
          path.join(installerDataSvc.installDir(), 'vbox.log')
        ];

        installer.installMsi(helper);

        expect(spy).to.have.been.calledOnce;
        expect(spy).to.have.been.calledWith('msiexec', opts);
      });
    });
  });

  describe('detection', function() {
    let stub, validateStub;

    beforeEach(function() {
      let stub = sandbox.stub(Util, 'executeCommand');
      if (process.platform === 'win32') {
        stub.onCall(0).resolves('%VBOX_INSTALL_PATH%');
        stub.onCall(1).resolves('folder/vbox');
        stub.onCall(2).resolves('5.0.8r1234');
      } else {
        stub.onCall(0).resolves('folder/vbox');
        stub.onCall(1).resolves('5.0.8r1234');
        sandbox.stub(Util, 'findText').resolves('dir=folder/vbox');
      }
      sandbox.stub(Util, 'folderContains').resolves('folder/vbox');
      validateStub = sandbox.stub(installer, 'validateVersion').returns();
    });

    it('should set virtualbox as detected in the appropriate folder when found', function(done) {
      return installer.detectExistingInstall(function(err) {
        expect(installer.option['detected'].location).to.equal('folder/vbox');
        done();
      });
    });

    it('should check the detected version', function(done) {
      return installer.detectExistingInstall(function() {
        expect(installer.option['detected'].version).to.equal('5.0.8');
        done();
      });
    });

    it('should validate the detected version against the required one', function(done) {
      return installer.detectExistingInstall(function() {
        expect(validateStub).calledOnce;
        done();
      });
    });
  });

  describe('version validation', function() {
    let option;

    beforeEach(function() {
      installer.addOption('detected','','',false);
      installer.selectedOption = 'detected';
      option = installer.option[installer.selectedOption];
    })

    it('should add warning for newer version',function(){
      installer.option['detected'].version = '5.0.16';
      installer.validateVersion();

      expect(option.error).to.equal('');
      expect(option.warning).to.equal('newerVersion');
      expect(option.valid).to.equal(true);
    });

    it('should add error for older version',function(){
      installer.option['detected'].version = '5.0.1';
      installer.validateVersion();

      expect(option.error).to.equal('oldVersion');
      expect(option.warning).to.equal('');
      expect(option.valid).to.equal(false);
    })

    it('should add neither warning nor error for recomended version',function(){
      installer.option['detected'].version = '5.0.8';
      installer.validateVersion();

      expect(option.error).to.equal('');
      expect(option.warning).to.equal('');
      expect(option.valid).to.equal(true);
    })
  })
});
